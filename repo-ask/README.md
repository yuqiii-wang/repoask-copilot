# @RepoAsk VS Code Extension

A VS Code plugin for searching, managing, and querying Confluence and Jira documentation directly within your IDE. Connects to your local API simulators for realistic document indexing and retrieval functionality.

## Features & Chat Participants

This extension provides two chat participants to assist you in VS Code:

### `@repoaskDoc`
The Doc Agent helps you answer general questions using your local document store.
*   **How it works**: It leverages `repoask_rank` to find the top relevant docs (using BM25/IDF ranking) from the `local-store` and `repoask_doc_check` to read the actual markdown content.
*   **Capabilities**: Bases answers solely on retrieved text (no hallucination). It provides citations, doc IDs, and titles for referenced material. Includes a "Log Action" feedback button linked to the prime referenced document.

### `@repoaskCode`
The Code Agent specializes in local code review and changes.
*   **How it works**: It reads `.github/prompts/*.md` guidelines dynamically to inform coding answers and understand requirements.
*   **Capabilities**: It can provide code updates as unified diffs and analyze changes. It focuses on understanding requirements from local prompt files.
