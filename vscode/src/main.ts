import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

import * as cliConfig from "./cliConfig";
import * as user from "./user";
import * as api from "./modalityApi";
import * as workspaces from "./workspaces";
import * as segments from "./segments";
import * as specs from "./specs";
import * as specCoverage from "./specCoverage";
import * as timelines from "./timelines";
import * as events from "./events";
import * as lsp from "./lsp";
import * as modalityLog from "./modalityLog";
import * as terminalLinkProvider from "./terminalLinkProvider";
import * as specFileCommands from "./specFileCommands";
import * as transitionGraph from "./transitionGraph";
import * as config from "./config";
import * as speqtrLinkProvider from "./speqtrLinkProvider";

export let log: vscode.OutputChannel;
let lspClient: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("Auxon SpeQTr");

    // If this is a fresh install, prompt for new first user creation
    await user.handleNewUserCreation();

    lspClient = await lsp.activateLspClient(context);

    const apiUrl = await config.modalityUrl();
    const allowInsecure = await config.allowInsecureHttps();
    let token = await config.userAuthToken();

    // We can't do anything without an auth token
    while (!token) {
        const userSuppliedAuthToken = await user.promptForValidAuthToken();
        if (userSuppliedAuthToken) {
            // Already validated in the input box
            cliConfig.setUserAuthToken(userSuppliedAuthToken);
            token = userSuppliedAuthToken;
        }
    }

    const apiClient = new api.Client(apiUrl.toString(), token, allowInsecure);

    terminalLinkProvider.register(context);
    modalityLog.register(context);
    transitionGraph.register(context, apiClient);
    specFileCommands.register(context);
    speqtrLinkProvider.register(context);

    const specCoverageProvider = new specCoverage.SpecCoverageProvider(apiClient);
    await specCoverageProvider.initialize(context);

    const workspacesTreeDataProvider = new workspaces.WorkspacesTreeDataProvider(apiClient);
    const segmentsTreeDataProvider = new segments.SegmentsTreeDataProvider(apiClient, specCoverageProvider);
    const timelinesTreeDataProvider = new timelines.TimelinesTreeDataProvider(apiClient);
    const eventsTreeDataProvider = new events.EventsTreeDataProvider(apiClient);
    const specsTreeDataProvider = new specs.SpecsTreeDataProvider(apiClient, specCoverageProvider);

    workspacesTreeDataProvider.onDidChangeActiveWorkspace((ws_ver) => {
        log.appendLine(`Active workspace change! ${ws_ver}`);
        segmentsTreeDataProvider.activeWorkspaceVersionId = ws_ver;
        segmentsTreeDataProvider.refresh();

        timelinesTreeDataProvider.activeWorkspaceVersionId = ws_ver;
        timelinesTreeDataProvider.refresh();

        eventsTreeDataProvider.activeWorkspaceVersionId = ws_ver;
        eventsTreeDataProvider.refresh();
    });

    segmentsTreeDataProvider.onDidChangeUsedSegments((ev) => {
        specsTreeDataProvider.setActiveSegmentIds(ev.activeSegmentIds);

        timelinesTreeDataProvider.usedSegmentConfig = ev.usedSegmentConfig;
        timelinesTreeDataProvider.activeSegments = ev.activeSegmentIds;
        timelinesTreeDataProvider.refresh();

        eventsTreeDataProvider.activeSegments = ev.activeSegmentIds;
        eventsTreeDataProvider.refresh();
    });

    workspacesTreeDataProvider.register(context);
    segmentsTreeDataProvider.register(context);
    timelinesTreeDataProvider.register(context);
    eventsTreeDataProvider.register(context);
    specsTreeDataProvider.register(context);
}

export function deactivate(): Thenable<void> | undefined {
    if (!lspClient) {
        return undefined;
    }
    return lspClient.stop();
}
