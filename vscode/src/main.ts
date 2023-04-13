import * as vscode from "vscode";
import { ExtensionContext } from 'vscode';
import * as modality_api from './generated-sources/modality-api';
import * as child_process from 'child_process';
import * as util from 'util';

import { ModalityWorkspaceTreeDataProvider, SegmentTreeItemData, TimelineTreeItemData, WorkspaceTreeItemData } from './workspaceProvider';
import * as config from './config';

const execFile = util.promisify(child_process.execFile);

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let lspClient: LanguageClient;
let apiClientConfig: modality_api.Configuration;

export let log: vscode.OutputChannel;

const CONFORM_EVAL_COMMAND: string = "auxon.conform.eval";
const MODALITY_LOG_COMMAND: string = "auxon.modality.log";
const MODALITY_WORKSPACE_USE_COMMAND: string = "auxon.modality.workspace.use";
const MODALITY_SEGMENT_USE_COMMAND: string = "auxon.modality.segment.use";
const MODALITY_SEGMENT_USE_WHOLE_WORKSPACE_COMMAND: string = "auxon.modality.segment.use.whole_workspace";
const MODALITY_SEGMENT_USE_ALL_SEGMENTS_COMMAND: string = "auxon.modality.segment.use.all_segments";
const MODALITY_TIMELINE_INSPECT_COMMAND: string = "auxon.modality.timeline.inspect";

const REFRESH_WORKSPACE_VIEW_COMMAND: string = "auxon.workspace_view.refresh";

export async function activate(context: ExtensionContext) {
    apiClientConfig = await config.modalityApiClientConfig();

    log = vscode.window.createOutputChannel("Auxon SpeQTr");
    await activateLspClient();

    let workspaceTreeDataProvider = new ModalityWorkspaceTreeDataProvider(apiClientConfig);
    vscode.window.createTreeView("modalityWorkspaces", { treeDataProvider: workspaceTreeDataProvider });

    vscode.window.registerTerminalLinkProvider(EVENT_COORDS_TERMINAL_LINK_PROVIDER);

    context.subscriptions.push(
        vscode.commands.registerCommand(REFRESH_WORKSPACE_VIEW_COMMAND, () => workspaceTreeDataProvider.refresh()),
        vscode.commands.registerCommand(CONFORM_EVAL_COMMAND, runConformEvalCommand),
        vscode.commands.registerCommand(MODALITY_LOG_COMMAND, runModalityLogCommand),
        vscode.commands.registerCommand(MODALITY_WORKSPACE_USE_COMMAND, runWorkspaceUseCommand),
        vscode.commands.registerCommand(MODALITY_SEGMENT_USE_COMMAND, runSegmentUseCommand),
        vscode.commands.registerCommand(MODALITY_SEGMENT_USE_WHOLE_WORKSPACE_COMMAND, runSegmentUseWholeWorkspaceCommand),
        vscode.commands.registerCommand(MODALITY_TIMELINE_INSPECT_COMMAND, runTimelineInspectCommand),
        vscode.commands.registerCommand(MODALITY_SEGMENT_USE_ALL_SEGMENTS_COMMAND, runSegmentUseAllSegmentsCommand)
    );
}

const EVENT_COORDS_RE_STR: string = "%[0-9a-f]{32}:[0-9a-f]+";
// Look for '..' ahead and behind, so we don't  match part of a coord..coord range
const EVENT_COORDS_RE: RegExp = RegExp(`(?<!\\.\\.)(${EVENT_COORDS_RE_STR})(\\.\\.)?`, "g");
const EVENT_COORDS_RANGE_RE: RegExp = RegExp(`(${EVENT_COORDS_RE_STR})\\.\\.(${EVENT_COORDS_RE_STR})`, "g");

const EVENT_COORDS_TERMINAL_LINK_PROVIDER: vscode.TerminalLinkProvider = {
    provideTerminalLinks: (context: vscode.TerminalLinkContext, token: vscode.CancellationToken) => {
        var links = [];

        for (const match of context.line.matchAll(EVENT_COORDS_RE)) {
            if (match[2] == "..") {
                continue;
            }

            const coord = match[2];
            links.push({
                startIndex: match.index,
                length: match[0].length,
                tooltip: 'View log around this event',
                data: { around: coord, radius: 5 }
            });
        }

        for (const match of context.line.matchAll(EVENT_COORDS_RANGE_RE)) {
            const firstCoord = match[1];
            const secondCoord = match[2];

            links.push({
                startIndex: match.index,
                length: match[0].length,
                tooltip: 'View log of this causal region',
                data: { from: firstCoord, to: secondCoord }
            });
        }

        return links;
    },
    handleTerminalLink: (link: any) => {
        vscode.commands.executeCommand(
            MODALITY_LOG_COMMAND,
            {
                type: "LogCommandArgs",
                around: link.data.around,
                radius: link.data.radius,
                from: link.data.from,
                to: link.data.to,
            }
        );
    }
};

export function deactivate(): Thenable<void> | undefined {
    if (!lspClient) {
        return undefined;
    }
    return lspClient.stop();
}

async function activateLspClient() {
    var serverPath = config.toolPath("speqtr_lsp");
    log.appendLine(`Using lsp executable at ${serverPath}`);

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: {
            command: serverPath,
            transport: TransportKind.ipc,
            options: { env: await config.toolEnv() }
        },
        debug: {
            command: serverPath,
            transport: TransportKind.ipc,
            options: { env: await config.toolDebugEnv() }
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'speqtr' }]
    };

    lspClient = new LanguageClient(
        'speqtrLanguageServer',
        'SpeQTr Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    lspClient.start();
}

type SpecEvalCommandArgs = {
    document_uri: string,
    behavior?: string,
    dry_run: boolean,
};

function runConformEvalCommand(args: SpecEvalCommandArgs) {
    const conformPath = config.toolPath("conform");

    let commandArgs = [
        "spec", "eval",
        "--file", vscode.Uri.parse(args.document_uri).fsPath
    ];

    if (args.behavior) {
        commandArgs.push("--behavior", args.behavior);
    }

    if (args.dry_run) {
        commandArgs.push("--dry-run");
    }

    const taskDef: vscode.TaskDefinition = {
        type: "auxon.conform.eval",
        command: conformPath,
        args: commandArgs
    };

    let problemMatchers = ["$conformEval"];
    const scope = vscode.workspace.workspaceFolders![0];
    const exec = new vscode.ProcessExecution(taskDef.command, taskDef.args);
    const target = vscode.workspace.workspaceFolders![0];

    let task = new vscode.Task(
        taskDef, scope, "conform", "conform source",
        exec, problemMatchers);

    task.group = vscode.TaskGroup.Build;
    task.presentationOptions = {
        echo: true,
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Dedicated,
        clear: true
    };

    return vscode.tasks.executeTask(task);
}

type ModalityLogCommandArgs = {
    type: "LogCommandArgs",
    thingToLog?: string,
    from?: string,
    to?: string,
    around?: string,
    radius?: string,
    segmentationRule?: string,
    segment?: string,
};

function runModalityLogCommand(args: ModalityLogCommandArgs | SegmentTreeItemData | TimelineTreeItemData) {
    const modality = config.toolPath("modality");

    let logCommandArgs: ModalityLogCommandArgs;
    switch (args.type) {
        case 'Segment':
            let segArgs = args as SegmentTreeItemData;
            logCommandArgs = {
                type: "LogCommandArgs",
                segmentationRule: segArgs.segment.id.ruleName,
                segment: segArgs.segment.id.segmentName
            };
            break;
        case 'Timeline':
            let tlArgs = args as TimelineTreeItemData;
            logCommandArgs = {
                type: "LogCommandArgs",
                thingToLog: tlArgs.timeline_overview.id
            };
            break;
        case 'LogCommandArgs':
            logCommandArgs = args as ModalityLogCommandArgs;
            break;
    }

    // We're going to send the text of the command line to the terminal. Build up the args list here.
    let modalityArgs = [modality, "log"];
    if (logCommandArgs.thingToLog) {
        let escapedAndQuotedThingToLog = JSON.stringify(logCommandArgs.thingToLog);
        modalityArgs.push(escapedAndQuotedThingToLog);
    }
    if (logCommandArgs.from) { modalityArgs.push("--from", logCommandArgs.from); }
    if (logCommandArgs.to) { modalityArgs.push("--to", logCommandArgs.to); }
    if (logCommandArgs.around) { modalityArgs.push("--around", logCommandArgs.around); }
    if (logCommandArgs.radius) { modalityArgs.push("--radius", logCommandArgs.radius); }
    if (logCommandArgs.segmentationRule) {
        let escapedAndQuotedSegmentationRule = JSON.stringify(logCommandArgs.segmentationRule);
        modalityArgs.push("--segmentation-rule", escapedAndQuotedSegmentationRule);
    }
    if (logCommandArgs.segment) {
        let escapedAndQuotedSegment = JSON.stringify(logCommandArgs.segment);
        modalityArgs.push("--segment", escapedAndQuotedSegment);
    }

    let term: vscode.Terminal = vscode.window.createTerminal({
        name: "modality log",
        location: vscode.TerminalLocation.Editor,
    });
    term.show();

    // The `exit` makes the shell close if you hit 'q' in the pager.
    let command = `${modalityArgs.join(" ")} | less -r; exit\n`;
    log.appendLine(`Running modality log using command line: ${command}`);
    term.sendText(command);
}

async function runWorkspaceUseCommand(args: WorkspaceTreeItemData) {
    let modality = config.toolPath("modality");
    // TODO use workspace version id for this
    await execFile(modality, ['workspace', 'use', args.workspace.name]);

    // TODO: keep expanded state when this happens
    await vscode.commands.executeCommand(REFRESH_WORKSPACE_VIEW_COMMAND);
}

async function runSegmentUseCommand(item: SegmentTreeItemData) {
    let modality = config.toolPath("modality");
    let args = ['segment', 'use', '--segmentation-rule', item.segment.id.ruleName, item.segment.id.segmentName];
    await execFile(modality, args);
    await vscode.commands.executeCommand(REFRESH_WORKSPACE_VIEW_COMMAND);
}

async function runSegmentUseWholeWorkspaceCommand(item: WorkspaceTreeItemData) {
    let modality = config.toolPath("modality");
    // TODO use workspace version id for this
    await execFile(modality, ['workspace', 'use', item.workspace.name]);
    await execFile(modality, ['segment', 'use', '--whole-workspace']);
    await vscode.commands.executeCommand(REFRESH_WORKSPACE_VIEW_COMMAND);
}

async function runTimelineInspectCommand(item: TimelineTreeItemData) {
    let timelinesApi = new modality_api.TimelinesApi(apiClientConfig);
    let timeline = await timelinesApi.getTimeline({timelineId: item.timeline_overview.id });
    let timelineJson = JSON.stringify(timeline, null, 4);

    const doc = await vscode.workspace.openTextDocument({ language: "json", content: timelineJson });
    await vscode.window.showTextDocument(doc);
}


async function runSegmentUseAllSegmentsCommand(item: WorkspaceTreeItemData) {
    let modality = config.toolPath("modality");
    // TODO ws version id
    await execFile(modality, ['workspace', 'use', item.workspace.name])
    await execFile(modality, ['segment', 'use', '--all-segments']);
    await vscode.commands.executeCommand(REFRESH_WORKSPACE_VIEW_COMMAND);
}
