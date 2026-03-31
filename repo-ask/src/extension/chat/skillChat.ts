import path from 'path';
import { selectDefaultChatModel, withTimeout, LLM_RESPONSE_TIMEOUT_MS, emitThinking } from './shared';

/**
 * Skill command handler for @repoask /skill.
 *
 * Flow:
 *   1. Filter stored docs to type === 'skill'.
 *   2. Rank filtered skills against the user query; pick the single best match.
 *   3. Load the skill content and stream an LLM answer guided by the skill instructions.
 */
async function runSkillCommand(
    vscodeApi: any,
    prompt: string,
    response: any,
    deps: {
        documentService: any;
        readAllMetadata: () => any[];
        readDocumentContent: (id: string) => string | null;
        storagePath: string;
    },
    options: { request?: any } = {}
) {
    const { documentService, readAllMetadata, readDocumentContent, storagePath } = deps;

    if (!vscodeApi.lm || !vscodeApi.LanguageModelChatMessage) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    // ── 1. Collect all skill-type docs ───────────────────────────────────────
    const allMeta = readAllMetadata();
    const skillDocs = allMeta.filter((m: any) => String(m.type || '').toLowerCase() === 'skill');

    if (skillDocs.length === 0) {
        response.markdown(
            'No skill documents found in the docstore.\n\n' +
            'Add skill docs by setting `"type": "skill"` in their metadata, or sync Confluence docs tagged as skills.'
        );
        return;
    }

    emitThinking(response, `Searching ${skillDocs.length} skill(s) for the best match...`);

    // ── 2. Rank all docs, then filter to skill IDs to find the best match ────
    const skillIdSet = new Set(skillDocs.map((m: any) => String(m.id)));
    const ranked = documentService.rankLocalDocuments(prompt, skillDocs.length * 3);
    const rankedSkills = (ranked || []).filter((d: any) => skillIdSet.has(String(d.id)));

    let topSkillMeta: any;
    if (rankedSkills.length > 0) {
        topSkillMeta = skillDocs.find((m: any) => String(m.id) === String(rankedSkills[0].id));
    } else {
        // No ranking match — fall back to first available skill
        topSkillMeta = skillDocs[0];
    }

    // ── 3. Load skill content ────────────────────────────────────────────────
    const skillContent = readDocumentContent(String(topSkillMeta.id));
    if (!skillContent || skillContent.trim().length === 0) {
        response.markdown(
            `Skill **${topSkillMeta.title}** was matched but has no content.\n` +
            'Refresh it from the sidebar and try again.'
        );
        return;
    }

    // Emit a file reference so the Copilot UI shows the skill doc link
    if (storagePath && typeof response.reference === 'function') {
        const docPath = path.join(storagePath, String(topSkillMeta.id), 'content.md');
        response.reference(vscodeApi.Uri.file(docPath));
    }

    const skillTitle = topSkillMeta.title || String(topSkillMeta.id);
    const skillUrl = topSkillMeta.url || '';

    response.markdown(
        `**Skill selected:** ${skillUrl ? `[${skillTitle}](${skillUrl})` : `**${skillTitle}**`}\n\n---\n\n`
    );

    // ── 4. Run the skill: skill content as instructions + user query ─────────
    const vsModel = await selectDefaultChatModel(vscodeApi, options);
    if (!vsModel) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    emitThinking(response, `Running skill: ${skillTitle}...`);

    const fullPrompt = [
        'You are executing the following skill. Follow its instructions precisely to answer the user request.',
        '',
        '## Skill Instructions',
        skillContent,
        '',
        '---',
        '',
        '## User Request',
        prompt
    ].join('\n');

    try {
        const llmResponse = await withTimeout(
            vsModel.sendRequest(
                [vscodeApi.LanguageModelChatMessage.User(fullPrompt)],
                {},
                options?.request?.token
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
                    response.markdown(chunk.value);
                }
            }
        }
    } catch (err: any) {
        response.markdown(`Error running skill: ${err?.message || err}`);
    }
}

export { runSkillCommand };
