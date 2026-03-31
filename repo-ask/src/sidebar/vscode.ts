declare function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

// acquireVsCodeApi() must be called exactly once
export const vscode = acquireVsCodeApi();
