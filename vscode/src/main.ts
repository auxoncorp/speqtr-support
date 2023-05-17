import * as vscode from "vscode";
import { LanguageClient } from 'vscode-languageclient/node';

import * as api from './modalityApi';
import * as workspaces from './workspaces';
import * as segments from './segments';
import * as specs from './specs';
import * as timelines from './timelines';
import * as lsp from './lsp';
import * as modalityLog from './modalityLog';
import * as terminalLinkProvider from './terminalLinkProvider';
import * as transitionGraph from './transitionGraph';
import * as config from "./config";

export let log: vscode.OutputChannel;
let lspClient: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("Auxon SpeQTr");
    lspClient = await lsp.activateLspClient(context);

    const apiUrl = await config.modalityUrl();
    const token = config.userAuthToken();
    const allowInsecure = await config.allowInsecureHttps();
    const apiClient = new api.Client(apiUrl.toString(), token, allowInsecure);

    terminalLinkProvider.register(context);
    modalityLog.register(context);
    transitionGraph.register(context, apiClient);

    var workspacesTreeDataProvider = new workspaces.WorkspacesTreeDataProvider(apiClient);
    let segmentsTreeDataProvider = new segments.SegmentsTreeDataProvider(apiClient);
    let timelinesTreeDataProvider = new timelines.TimelinesTreeDataProvider(apiClient);
    let specsTreeDataProvider = new specs.SpecsTreeDataProvider(apiClient);

    workspacesTreeDataProvider.onDidChangeActiveWorkspace((ws_ver) => {
        log.appendLine(`Active workspace change! ${ws_ver}`);
        segmentsTreeDataProvider.activeWorkspaceVersionId = ws_ver;
        segmentsTreeDataProvider.refresh();

        timelinesTreeDataProvider.activeWorkspaceVersionId = ws_ver;
        timelinesTreeDataProvider.refresh();
    });

    segmentsTreeDataProvider.onDidChangeUsedSegments((ev) => {
        timelinesTreeDataProvider.usedSegmentConfig = ev.usedSegmentConfig;
        timelinesTreeDataProvider.activeSegments = ev.activeSegmentIds;
        timelinesTreeDataProvider.refresh();
    });

    workspacesTreeDataProvider.register(context);
    segmentsTreeDataProvider.register(context);
    timelinesTreeDataProvider.register(context);
    specsTreeDataProvider.register(context);
}

export function deactivate(): Thenable<void> | undefined {
    if (!lspClient) { return undefined; }
    return lspClient.stop();
}
