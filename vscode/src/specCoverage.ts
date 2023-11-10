import * as api from "./modalityApi";
import * as vscode from "vscode";

interface SpecCoverageParams {
    segmentId: api.WorkspaceSegmentId
}

export function showSpecCoverage(params: SpecCoverageParams, apiClient: api.Client) {
    let html = "<html>";
    html += `<h1>Coverage report for segment ${params.segmentId.segment_name}</h1>`;
    html += `<button>Open HTML</button>`;
    html += "</html>";

    const panel = vscode.window.createWebviewPanel(
        "auxon.specCoverageView",
        `Coverage Report: ${params.segmentId.segment_name}`,
        vscode.ViewColumn.One,
        {}
    );
    panel.webview.html = html;
}