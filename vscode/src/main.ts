import * as vscode from "vscode";
import { LanguageClient } from 'vscode-languageclient/node';

import * as modality_api from './generated-sources/modality-api';
import * as workspaces from './workspaces';
import * as segments from './segments';
import * as timelines from './timelines';
import * as config from './config';
import * as lsp from './lsp';
import * as modalityLog from './modalityLog';
import * as terminalLinkProvider from './terminalLinkProvider';

export let log: vscode.OutputChannel;
let lspClient: LanguageClient;
let apiClientConfig: modality_api.Configuration;

export async function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("Auxon SpeQTr");

    apiClientConfig = await config.modalityApiClientConfig();
    lspClient = await lsp.activateLspClient(context);
    terminalLinkProvider.register(context);
    modalityLog.register(context);

    var workspacesTreeDataProvider = new workspaces.WorkspacesTreeDataProvider(apiClientConfig);
    let segmentsTreeDataProvider = new segments.SegmentsTreeDataProvider(apiClientConfig);
    let timelinesTreeDataProvider = new timelines.TimelinesTreeDataProvider(apiClientConfig);
-
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
}

export function deactivate(): Thenable<void> | undefined {
    if (!lspClient) { return undefined; }
    return lspClient.stop();
}
