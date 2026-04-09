import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { selectDefaultChatModel, withTimeout, LLM_RESPONSE_TIMEOUT_MS, emitThinking } from './shared';

const execFileAsync = promisify(execFile);

const PROD_PLAN_ID = 'production-support-plan';
const PROD_MAIN_ID = 'production-support-main';

// ---------------------------------------------------------------------------
// Python discovery — avoids the Windows Store 'python' alias
// ---------------------------------------------------------------------------
let _cachedPython: string | null = null;

async function findPython(): Promise<string> {
    if (_cachedPython) return _cachedPython;
    const candidates = [
        process.env.PYTHON_PATH,
        'python3',
        'python',
    ].filter(Boolean) as string[];
    for (const cmd of candidates) {
        try {
            await execFileAsync(cmd, ['--version'], { timeout: 5_000 });
            _cachedPython = cmd;
            return cmd;
        } catch { /* try next */ }
    }
    throw new Error(
        'No working Python interpreter found. ' +
        'Install Python and make sure `python3` or `python` is on your PATH, ' +
        'or set the PYTHON_PATH environment variable.'
    );
}

// Locate a scripts dir — prefers the compiled out/ copy so packaged builds work.
function resolveScriptsDir(extensionPath: string, skillId: string): string {
    const outDir = path.join(extensionPath, 'out', 'default_docs', skillId, 'scripts');
    const srcDir = path.join(extensionPath, 'src', 'default_docs', skillId, 'scripts');
    return fs.existsSync(outDir) ? outDir : srcDir;
}

// ---------------------------------------------------------------------------
// Agentic tool-use loop
// Sends a prompt to the LLM with all available vscode.lm.tools, streams text
// to `response`, handles LanguageModelToolCallPart by invoking those tools,
// and continues until the model stops calling tools (or maxIter is reached).
// Returns the full accumulated text output.
// ---------------------------------------------------------------------------
async function runLLMWithTools(
    vscodeApi: any,
    vsModel: any,
    initialMessages: any[],
    response: any,
    token: any,
    maxIter = 8,
    toolInvocationToken?: any
): Promise<string> {
    // Filter out tools with invalid schemas (object type missing properties).
    // Some 3rd-party extensions register tools whose inputSchema lacks `properties`,
    // which causes the model API to reject the entire request with a 400 error.
    const tools: any[] = (Array.isArray(vscodeApi.lm?.tools) ? [...vscodeApi.lm.tools] : [])
        .filter((t: any) => {
            const s = t?.inputSchema;
            if (!s) return true;                                   // no schema — ok
            if (s.type === 'object' && !s.properties) return false; // invalid
            return true;
        });
    let messages = [...initialMessages];
    let accumulatedText = '';

    for (let iter = 0; iter < maxIter; iter++) {
        const sendOpts = tools.length > 0 ? { tools } : {};
        const llmResp = await withTimeout(
            vsModel.sendRequest(messages, sendOpts, token),
            LLM_RESPONSE_TIMEOUT_MS,
            null
        );
        if (!llmResp) break;

        const assistantParts: any[] = [];
        const toolCalls: any[] = [];

        for await (const chunk of llmResp.stream) {
            if (chunk instanceof vscodeApi.LanguageModelTextPart) {
                response.markdown(chunk.value);
                accumulatedText += chunk.value;
                assistantParts.push(chunk);
            } else if (chunk instanceof vscodeApi.LanguageModelToolCallPart) {
                toolCalls.push(chunk);
                assistantParts.push(chunk);
            }
        }

        if (toolCalls.length === 0) break;

        // Append assistant turn (text + tool calls) to history
        messages = [
            ...messages,
            vscodeApi.LanguageModelChatMessage.Assistant(assistantParts),
        ];

        // Invoke every requested tool and collect results
        const resultParts: any[] = [];
        for (const call of toolCalls) {
            try {
                const invokeOpts: any = { input: call.input };
                if (toolInvocationToken !== undefined) {
                    invokeOpts.toolInvocationToken = toolInvocationToken;
                }
                const result = await vscodeApi.lm.invokeTool(
                    call.name, invokeOpts, token
                );
                resultParts.push(
                    new vscodeApi.LanguageModelToolResultPart(call.callId, result.content)
                );
            } catch (err: any) {
                resultParts.push(
                    new vscodeApi.LanguageModelToolResultPart(call.callId, [
                        new vscodeApi.LanguageModelTextPart(`Tool error: ${err?.message ?? err}`)
                    ])
                );
            }
        }
        messages = [...messages, vscodeApi.LanguageModelChatMessage.User(resultParts)];
    }

    return accumulatedText;
}

// Generic Python runner — returns parsed stdout or an error message.
async function runPythonScript(
    scriptPath: string,
    args: string[],
    opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ data: any | null; error: string | null }> {
    if (!fs.existsSync(scriptPath)) {
        return { data: null, error: `Script not found: ${scriptPath}` };
    }
    try {
        const cmd = await findPython();
        const { stdout, stderr } = await execFileAsync(cmd, [scriptPath, ...args], {
            cwd: opts.cwd,
            timeout: opts.timeoutMs ?? 30_000,
        });
        const trimmed = stdout.trim();
        if (!trimmed) {
            return { data: null, error: stderr?.trim() || 'No output' };
        }
        return { data: JSON.parse(trimmed), error: stderr?.trim() || null };
    } catch (err: any) {
        const stderr = err.stderr?.trim() || '';
        // execFile rejects on non-zero exit; stdout may still hold partial output
        const partial = err.stdout?.trim();
        if (partial) {
            try { return { data: JSON.parse(partial), error: stderr || null }; } catch {}
        }
        return { data: null, error: stderr || err.message || String(err) };
    }
}

// Mirrors sanitizeFileSegment in utils.ts — used to predict the SKILL.md path.
function sanitizeSkillTitle(title: string): string {
    return String(title || 'item').toLowerCase().replace(/[^a-z0-9-_ ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 64) || 'item';
}

/**
 * Ensures production-support-plan and production-support-main skill files exist in
 * <workspace>/.github/skills/. If either is absent from the docstore it is first
 * synced from the bundled default_docs, then written to .github/skills/.
 */
function ensureDefaultSkills(
    vscodeApi: any,
    deps: {
        documentService: any;
        readAllMetadata: () => any[];
        readDocumentContent: (id: string) => string | null;
        extensionPath: string;
    }
): void {
    const { documentService, readAllMetadata, readDocumentContent, extensionPath } = deps;
    const DEFAULT_IDS = [PROD_PLAN_ID, PROD_MAIN_ID];

    let allMeta = readAllMetadata();
    const missingFromStorage = DEFAULT_IDS.filter(id => !allMeta.find((m: any) => String(m.id) === id));
    if (missingFromStorage.length > 0) {
        documentService.syncDefaultDocs(extensionPath);
        allMeta = readAllMetadata();
    }

    const workspaceRoot = vscodeApi.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (!workspaceRoot) return;

    for (const id of DEFAULT_IDS) {
        const meta = allMeta.find((m: any) => String(m.id) === id);
        if (!meta) continue;
        const safeTitle = sanitizeSkillTitle(meta.title || id);
        const skillFilePath = path.join(workspaceRoot, '.github', 'skills', safeTitle, 'SKILL.md');
        if (!fs.existsSync(skillFilePath)) {
            const content = readDocumentContent(id);
            if (content && content.trim().length > 0) {
                documentService.writeDocumentSkillFile(meta, content);
            }
        }
    }
}

/**
 * Skill command handler for @repoask /production-support.
 *
 * Workflow:
 *   1. Ensure plan/main skills exist in the docstore.
 *   2. Fetch available log listing via prod_support_tools.py fetch-logs.
 *   3. Stream LLM with skill instructions + log listing → keyword/log proposal.
 *   4. Build full scan plan via prod_support_tools.py build-plan.
 *   5. Show plan, persist pending-plan.json, offer Continue button.
 */
async function runProductionSupportCommand(
    vscodeApi: any,
    prompt: string,
    response: any,
    deps: {
        documentService: any;
        readAllMetadata: () => any[];
        readDocumentContent: (id: string) => string | null;
        storagePath: string;
        extensionPath: string;
    },
    options: { request?: any; token?: any } = {}
) {
    const { documentService, readAllMetadata, readDocumentContent, storagePath, extensionPath } = deps;

    if (!vscodeApi.lm || !vscodeApi.LanguageModelChatMessage) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    // ── 1. Ensure default skills are present ─────────────────────────────────
    ensureDefaultSkills(vscodeApi, { documentService, readAllMetadata, readDocumentContent, extensionPath });

    const allMeta = readAllMetadata();
    const skillDocs = allMeta.filter((m: any) => String(m.type || '').toLowerCase() === 'skill');
    if (skillDocs.length === 0) {
        response.markdown(
            'No skill documents found in the docstore.\n\n' +
            'Add skill docs by setting `"type": "skill"` in their metadata, or sync Confluence docs tagged as skills.'
        );
        return;
    }

    const planMeta = skillDocs.find((m: any) => String(m.id) === PROD_PLAN_ID) ?? skillDocs[0];

    const skillContent = readDocumentContent(String(planMeta.id));
    if (!skillContent || skillContent.trim().length === 0) {
        response.markdown(`Skill **${planMeta.title}** has no content. Refresh it from the sidebar and try again.`);
        return;
    }

    if (storagePath && typeof response.reference === 'function') {
        response.reference(vscodeApi.Uri.file(path.join(storagePath, String(planMeta.id), 'content.md')));
    }

    const skillTitle = planMeta.title || String(planMeta.id);
    const skillUrl   = planMeta.url || '';
    response.markdown(`**Skill selected:** ${skillUrl ? `[${skillTitle}](${skillUrl})` : `**${skillTitle}**`}\n\n---\n\n`);

    // ── 2. Fetch log listing via Python tool ──────────────────────────────────
    emitThinking(response, 'Fetching available log files from server...');
    const planScriptsDir = resolveScriptsDir(extensionPath, PROD_PLAN_ID);
    const toolScript     = path.join(planScriptsDir, 'prod_support_tools.py');

    const [
        { data: logListing, error: fetchError },
        { data: currentTime },
    ] = await Promise.all([
        runPythonScript(toolScript, ['fetch-logs', '--env', 'local'], { cwd: planScriptsDir, timeoutMs: 10_000 }),
        runPythonScript(toolScript, ['get-time'],                     { cwd: planScriptsDir, timeoutMs: 5_000 }),
    ]);

    const logListingLines: string[] = [];
    if (logListing && Array.isArray(logListing) && logListing.length > 0) {
        response.markdown(`> Log discovery: found **${logListing.length}** log prefix(es) with available files.\n\n`);
        logListingLines.push(
            '## Available Log Listing',
            'The following log files are currently available on the server.',
            'Use the exact `prefix` values from this listing in `proposed_logs` — do NOT fabricate prefixes.',
            '```json',
            JSON.stringify(logListing, null, 2),
            '```'
        );
    } else {
        const reason = fetchError || 'unknown error';
        response.markdown(`> **Warning:** Failed to fetch log listing — ${reason}\n\n`);
        logListingLines.push(
            '## Available Log Listing',
            'ERROR: The log listing could not be fetched from the server.',
            `Reason: ${reason}`,
            'Follow the fallback instructions in Step 1 (skip log scanning, use repoask_doc_check).'
        );
    }

    // ── 3. LLM populates plan template (non-streaming) ───────────────────────
    const vsModel = await selectDefaultChatModel(vscodeApi, options);
    if (!vsModel) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    // Load plan template from scripts dir
    const templatePath = path.join(planScriptsDir, 'plan_template.json');
    let planTemplateText = '';
    try {
        planTemplateText = fs.readFileSync(templatePath, 'utf8');
    } catch {
        planTemplateText = '{}';
    }

    const currentTimeLines: string[] = [];
    if (currentTime && typeof currentTime === 'object') {
        currentTimeLines.push(
            '## Current Time',
            `The current UTC time is **${currentTime.display}**.`,
            `Use compact format \`${currentTime.compact}\` for \`incident_time\` when no specific time is in the query.`,
            `Use ISO-8601 \`${currentTime.iso8601}\` as the reference point for time ranges when none are specified.`,
        );
    }

    emitThinking(response, `Populating plan template...`);

    const fullPrompt = [
        'You are executing the following skill. Follow its instructions precisely.',
        'Your output must be ONLY a single populated JSON object — no markdown fences, no explanation.',
        '',
        '## Skill Instructions',
        skillContent,
        '',
        '---',
        '',
        ...currentTimeLines,
        ...(currentTimeLines.length > 0 ? ['', '---', ''] : []),
        ...logListingLines,
        ...(logListingLines.length > 0 ? ['', '---', ''] : []),
        '## Plan Template',
        'Populate every field in the template below for the user request.',
        'Return the completed JSON only — omit the "__instructions" key.',
        planTemplateText,
        '',
        '## User Request',
        prompt,
    ].join('\n');

    let accumulatedOutput = '';
    try {
        const llmResponse = await withTimeout(
            vsModel.sendRequest(
                [vscodeApi.LanguageModelChatMessage.User(fullPrompt)],
                {},
                options?.token
            ),
            LLM_RESPONSE_TIMEOUT_MS,
            null
        );
        if (!llmResponse) {
            response.markdown('Skill execution timed out. Please try again.');
            return;
        }
        if (llmResponse.stream) {
            for await (const chunk of llmResponse.stream) {
                if (chunk instanceof vscodeApi.LanguageModelTextPart) {
                    accumulatedOutput += chunk.value;
                }
            }
        }
    } catch (err: any) {
        response.markdown(`Error running skill: ${err?.message || err}`);
        return;
    }

    // Show the populated template as a clean JSON block (no streaming noise)
    const populatedJson = extractJsonBlock(accumulatedOutput);
    if (populatedJson) {
        response.markdown(`**Populated Plan**\n\`\`\`json\n${JSON.stringify(populatedJson, null, 2)}\n\`\`\`\n\n`);
    } else {
        response.markdown(`> Could not extract plan JSON from LLM output.\n\n`);
    }

    // ── 4. Build scan plan via Python tool (best-effort, silent) ────────────
    const proposalJson = normalizeProposal(populatedJson);
    let planToSave: any = { original_query: prompt, scan_tasks: [] };

    if (proposalJson) {
        const proposalPath   = path.join(storagePath, 'proposal.json');
        const logListingPath = path.join(storagePath, 'log-listing.json');
        try {
            fs.writeFileSync(proposalPath,   JSON.stringify(proposalJson,    null, 2), 'utf8');
            fs.writeFileSync(logListingPath, JSON.stringify(logListing || [], null, 2), 'utf8');
        } catch { /* non-fatal */ }

        emitThinking(response, 'Building scan plan...');
        const { data: planJson, error: buildError } = await runPythonScript(
            toolScript,
            ['build-plan', '--proposal', proposalPath, '--log-listing', logListingPath],
            { cwd: planScriptsDir, timeoutMs: 15_000 }
        );

        if (buildError) {
            response.markdown(`> **Plan builder warnings:** ${buildError}\n\n`);
        }

        if (planJson) {
            // Carry proposed_keywords + proposed_logs forward so main.py can use
            // them directly to screen logs, even if scan_tasks are rebuilt later.
            planToSave = {
                ...planJson,
                proposed_keywords: proposalJson.proposed_keywords ?? [],
                proposed_logs:     proposalJson.proposed_logs     ?? {},
            };
            const taskCount = Array.isArray(planJson.scan_tasks) ? planJson.scan_tasks.length : 0;
            if (taskCount > 0) {
                response.markdown(`\n> Scan plan ready — **${taskCount}** task(s) queued. Click Continue to run.\n\n`);
            } else {
                response.markdown('> No scan tasks were generated — check that the proposed log prefixes match available logs.\n\n');
            }
        } else {
            planToSave = proposalJson;
        }
    }

    // ── 5. Persist plan and always offer Continue ─────────────────────────────
    try {
        fs.writeFileSync(path.join(storagePath, 'pending-plan.json'), JSON.stringify(planToSave, null, 2), 'utf8');
    } catch { /* non-fatal */ }

    response.button({
        command: 'repo-ask.runProductionSupportMain',
        title: 'Continue — Run Production Support Main',
        arguments: [prompt],
    });
}

/**
 * Runs the production-support-main skill:
 *   1. Reads pending-plan.json saved by the plan command.
 *   2. Executes prod_support_tools (main.py) to produce a keyword hit-list.
 *   3. Streams LLM for root-cause analysis.
 */
async function runProductionSupportMainSkill(
    vscodeApi: any,
    originalPrompt: string,
    response: any,
    deps: {
        documentService: any;
        readAllMetadata: () => any[];
        readDocumentContent: (id: string) => string | null;
        storagePath: string;
        extensionPath: string;
    },
    options: { request?: any; token?: any } = {}
) {
    const { readAllMetadata, readDocumentContent, storagePath, extensionPath } = deps;

    // ── 1. Read pending plan ──────────────────────────────────────────────────
    const pendingPlanPath = path.join(storagePath, 'pending-plan.json');
    let planJson: any;
    try {
        planJson = JSON.parse(fs.readFileSync(pendingPlanPath, 'utf8'));
    } catch {
        response.markdown('No pending scan plan found. Run `/production-support` first to generate a plan.');
        return;
    }

    // ── 1b. If scan_tasks is empty, re-fetch logs + rebuild (or synthesize) ──
    if (!Array.isArray(planJson.scan_tasks) || planJson.scan_tasks.length === 0) {
        const proposalPath   = path.join(storagePath, 'proposal.json');
        const logListingPath = path.join(storagePath, 'log-listing.json');
        const planScriptsDir = resolveScriptsDir(extensionPath, PROD_PLAN_ID);
        const toolScript     = path.join(planScriptsDir, 'prod_support_tools.py');

        emitThinking(response, 'Scan tasks missing — fetching fresh log listing...');
        const { data: freshListing } = await runPythonScript(
            toolScript, ['fetch-logs', '--env', 'local'],
            { cwd: planScriptsDir, timeoutMs: 10_000 }
        );
        if (freshListing && Array.isArray(freshListing) && freshListing.length > 0) {
            try { fs.writeFileSync(logListingPath, JSON.stringify(freshListing, null, 2), 'utf8'); } catch { /* non-fatal */ }
        }

        // Use saved proposal.json — or synthesize one from original_query
        let proposalToUse: any = null;
        if (fs.existsSync(proposalPath)) {
            try { proposalToUse = JSON.parse(fs.readFileSync(proposalPath, 'utf8')); } catch { /* fall through */ }
        }
        if (!proposalToUse) {
            // Synthesize: tokenize the original query, scan all available logs
            const queryTokens = (planJson.original_query || '')
                .split(/\s+/).map((w: string) => w.toLowerCase())
                .filter((w: string) => w.length >= 3);
            const allPrefixes = (freshListing || []).map((e: any) => e.prefix);
            proposalToUse = {
                incident_summary: planJson.original_query || '',
                environment: 'local',
                original_query: planJson.original_query || '',
                extracted_identifiers: [],
                proposed_keywords: queryTokens.slice(0, 12),
                proposed_logs: Object.fromEntries(allPrefixes.map((p: string) => [p, {}])),
            };
            try { fs.writeFileSync(proposalPath, JSON.stringify(proposalToUse, null, 2), 'utf8'); } catch { /* non-fatal */ }
        }

        if (fs.existsSync(logListingPath)) {
            emitThinking(response, 'Rebuilding scan plan...');
            const { data: rebuilt, error: rebuildError } = await runPythonScript(
                toolScript,
                ['build-plan', '--proposal', proposalPath, '--log-listing', logListingPath],
                { cwd: planScriptsDir, timeoutMs: 15_000 }
            );
            if (rebuilt && Array.isArray(rebuilt.scan_tasks) && rebuilt.scan_tasks.length > 0) {
                planJson = rebuilt;
                try { fs.writeFileSync(pendingPlanPath, JSON.stringify(planJson, null, 2), 'utf8'); } catch { /* non-fatal */ }
                response.markdown(`> Rebuilt scan plan — **${rebuilt.scan_tasks.length}** task(s).\n\n`);
            } else if (rebuildError) {
                response.markdown(`> **Plan rebuild warning:** ${rebuildError}\n\n`);
            }
        }
    }

    const allMeta  = readAllMetadata();
    const mainMeta = allMeta.find((m: any) => String(m.id) === PROD_MAIN_ID);
    if (!mainMeta) {
        response.markdown('`production-support-main` skill not found in docstore. Refresh docs from the sidebar and try again.');
        return;
    }

    const mainContent = readDocumentContent(String(mainMeta.id));
    if (!mainContent || mainContent.trim().length === 0) {
        response.markdown('`production-support-main` skill has no content. Refresh it from the sidebar and try again.');
        return;
    }

    const mainTitle = mainMeta.title || PROD_MAIN_ID;
    const mainUrl   = mainMeta.url || '';
    response.markdown(`**Skill selected:** ${mainUrl ? `[${mainTitle}](${mainUrl})` : `**${mainTitle}**`}\n\n---\n\n`);

    if (storagePath && typeof response.reference === 'function') {
        response.reference(vscodeApi.Uri.file(path.join(storagePath, String(mainMeta.id), 'content.md')));
    }

    // ── 2. Run log scanner via main.py ────────────────────────────────────────
    if (!Array.isArray(planJson.scan_tasks) || planJson.scan_tasks.length === 0) {
        response.markdown(
            '**Log scanner skipped** — no scan tasks could be built.\n\n' +
            'The log server may be unreachable. Check that `logtail_server.py` is running, then re-run `/production-support`.'
        );
        return;
    }

    const mainScriptsDir = resolveScriptsDir(extensionPath, PROD_MAIN_ID);
    const mainPyPath     = path.join(mainScriptsDir, 'main.py');

    emitThinking(response, 'Running log scanner (main.py)...');
    const { data: scanData, error: scanError } = await runPythonScript(
        mainPyPath,
        ['--plan', pendingPlanPath],
        { cwd: mainScriptsDir, timeoutMs: 120_000 }
    );

    const scanResultJson = scanData ? JSON.stringify(scanData, null, 2) : '';

    if (!scanResultJson) {
        response.markdown(
            'Log scanner produced no output.\n\n' +
            (scanError ? `**Scanner stderr:**\n\`\`\`\n${scanError}\n\`\`\`` : '')
        );
        return;
    }

    response.markdown(`**Scanner output (keyword hit-list)**\n\`\`\`json\n${scanResultJson}\n\`\`\`\n\n`);
    if (scanError) {
        response.markdown(`**Scanner warnings**\n\`\`\`\n${scanError}\n\`\`\`\n\n`);
    }

    // ── 3. LLM root-cause analysis ────────────────────────────────────────────
    const vsModel = await selectDefaultChatModel(vscodeApi, options);
    if (!vsModel) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    emitThinking(response, 'Analysing scan results (free workspace search enabled)...');

    const mainPrompt = [
        'You are executing the following skill. Follow its instructions precisely to answer the user request.',
        'You have access to workspace tools — use them freely to search and read source code files.',
        '',
        '## Skill Instructions',
        mainContent,
        '',
        '---',
        '',
        '## Scan Plan',
        '```json',
        JSON.stringify(planJson, null, 2),
        '```',
        '',
        '## Scanner Output (keyword → timestamps hit-list)',
        '```json',
        scanResultJson,
        '```',
        '',
        '## Original User Request',
        originalPrompt,
    ].join('\n');

    let mainAnalysisText = '';
    try {
        mainAnalysisText = await runLLMWithTools(
            vscodeApi, vsModel,
            [vscodeApi.LanguageModelChatMessage.User(mainPrompt)],
            response,
            options?.token,
            20,
            options?.request?.toolInvocationToken
        );
    } catch (err: any) {
        response.markdown(`Error running main skill: ${err?.message || err}`);
        return;
    }

    // ── 4. Offer Check Code Logic button ──────────────────────────────────────
    response.button({
        command: 'repo-ask.checkCodeLogic',
        title: 'Check Code Logic',
        arguments: [originalPrompt, mainAnalysisText],
    });
}

/**
 * Normalises an LLM-produced proposal object to the canonical shape expected
 * by build_plan.py.  Accepts common field-name variants the LLM may emit
 * (e.g. `keywords` instead of `proposed_keywords`).
 * Returns null when no usable keywords can be found.
 */
function normalizeProposal(obj: any): any | null {
    if (!obj || typeof obj !== 'object') return null;
    const keywords: string[] =
        obj.proposed_keywords ?? obj.keywords ?? obj.words ??
        obj.search_keywords ?? obj.scan_keywords ?? [];
    const logs =
        obj.proposed_logs ?? obj.logs ?? obj.log_prefixes ??
        obj.selected_logs ?? obj.log_names ?? {};
    if (!Array.isArray(keywords) || keywords.length === 0) return null;
    const normalizedLogs =
        Array.isArray(logs) ? Object.fromEntries(logs.map((p: string) => [p, {}]))
        : (typeof logs === 'object' && logs !== null) ? logs
        : {};
    return {
        ...obj,
        proposed_keywords: keywords,
        proposed_logs: normalizedLogs,
    };
}

/**
 * Extracts the first JSON object from a markdown/text string.
 * Handles both fenced ```json ... ``` blocks and bare { ... } objects.
 */
function extractJsonBlock(text: string): any | null {
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const candidate = fenceMatch ? fenceMatch[1] : text;

    const start = candidate.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let end = -1;
    for (let i = start; i < candidate.length; i++) {
        if (candidate[i] === '{') depth++;
        else if (candidate[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) return null;

    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
}

export { runProductionSupportCommand, runProductionSupportMainSkill };
