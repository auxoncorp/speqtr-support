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
import * as modalityEventInspect from "./modalityEventInspect";
import * as terminalLinkProvider from "./terminalLinkProvider";
import * as specFileCommands from "./specFileCommands";
import * as experimentFileCommands from "./experimentFileCommands";
import * as transitionGraph from "./transitionGraph";
import * as config from "./config";
import * as speqtrLinkProvider from "./speqtrLinkProvider";
import * as mutators from "./mutators";
import * as mutations from "./mutations";
import * as deviantCommands from "./deviantCommands";
import * as experiments from "./experiments";
import * as workspaceState from "./workspaceState";

export let log: vscode.OutputChannel;
let lspClient: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("Auxon");

    const apiUrl = await config.modalityUrl();
    const modalitydIsAlive = await api.isModalitydReachable(apiUrl.toString());
    if (!modalitydIsAlive) {
        const msg =
            `The Auxon Modality backend server cannot be reached at '${apiUrl}'. ` +
            `If modalityd is not running locally, set the 'auxon.modalityUrl' configuration`;
        throw new Error(msg);
    }

    // If this is a fresh install, prompt for new first user creation
    await user.handleNewUserCreation();

    lspClient = await lsp.activateLspClient(context);

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
    const wss = await workspaceState.WorkspaceAndSegmentState.create(apiClient);

    terminalLinkProvider.register(context);
    modalityLog.register(context);
    modalityEventInspect.register(context);
    transitionGraph.register(context, apiClient);
    specFileCommands.register(context);
    speqtrLinkProvider.register(context);
    deviantCommands.register(context);
    experimentFileCommands.register(context);

    const specCoverageProvider = new specCoverage.SpecCoverageProvider(apiClient, context);

    // The tree view providers all register themselves with the window
    // when we new them up, so we don't need to hold on to them.
    new workspaces.WorkspacesTreeDataProvider(apiClient, wss, context);
    new segments.SegmentsTreeDataProvider(apiClient, specCoverageProvider, wss, context);
    const timelinesProvider = new timelines.TimelinesTreeDataProvider(apiClient, wss, context);
    const eventsProvider = new events.EventsTreeDataProvider(apiClient, wss, context);

    timelinesProvider.view.onDidChangeSelection(async (event) => {
        const selection = event.selection
            .filter((item) => item instanceof timelines.TimelineLeafTreeItemData && item.timelineId != undefined)
            .map((item) => {
                return { timelineId: item.timelineId as api.TimelineId, timelineName: item.name };
            });
        eventsProvider.setSelectedTimelines(selection);
    });

    new specs.SpecsTreeDataProvider(apiClient, specCoverageProvider, wss, context);

    new mutators.MutatorsTreeDataProvider(apiClient, wss, context);
    new mutations.MutationsTreeDataProvider(apiClient, wss, context);
    new experiments.ExperimentsTreeDataProvider(apiClient, wss, context);
}

export function deactivate(): Thenable<void> | undefined {
    if (!lspClient) {
        return undefined;
    }
    return lspClient.stop();
}
