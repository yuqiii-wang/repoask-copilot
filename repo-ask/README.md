# @RepoAsk VS Code Extension

A VS Code plugin for searching, managing, and querying Confluence and Jira documentation directly within your IDE. Connects to your local API simulators for realistic document indexing and retrieval functionality.

## Features & Chat Participants

This extension provides two primary chat participants to assist you in VS Code:

### `@repoaskDoc`
The Doc Agent helps you answer general questions using your local document store.
*   **How it works**: It leverages `repoask_rank` to find the top relevant docs (using BM25/IDF ranking) from the `local-store` and `repoask_doc_check` to read the actual markdown content.
*   **Capabilities**: Bases answers solely on retrieved text (no hallucination). It provides citations, doc IDs, and titles for referenced material. Includes a "Log Action" feedback button linked to the prime referenced document.

### `@repoaskCode`
The Code Agent specializes in local code review, codebase exploration, and feature changes.
*   **How it works**: Uses the `repoask_code_new_feat` tool to review new feature queries (analyzing git diffs, checking Jira prompt files in `.github/prompts/*.md`, and hooking up Jira ID queries to locate commit code). It uses `repoask_code_explore` for fast directory structural traversal (`ls`) and code pattern matching (`grep`).
*   **Capabilities**: It can provide code updates as unified diffs and analyze changes before applying them. It reads `.github/prompts/*.md` guidelines dynamically to inform coding answers.
