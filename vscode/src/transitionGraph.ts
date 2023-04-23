import * as vscode from 'vscode';
import * as modality_api from './generated-sources/modality-api';
import { apiClientConfig } from './main';

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(URI_SCHEME, new TransitionGraphContentProvider()),
    );
}

// These will be put into the 'path' component of the uri, as base64 encoded json. Yep.
export interface TimelineParams {
    type: "timelines",
    timelines: string[],
    groupBy?: string[]
}

export interface SegmentParams {
    type: "segment",
    segmentId: modality_api.WorkspaceSegmentId,
    groupBy?: string[]
}

export type TransitionGraphParams = TimelineParams | SegmentParams;

interface GraphGroupingItem {
    label: string,
    kind?: vscode.QuickPickItemKind, 
    groupBy?: string[],
    custom?: boolean
}

export function promptForGraphGrouping(picked: (groupBy: string[]) => void) {
    function step1() {
        const quickPick: vscode.QuickPick<GraphGroupingItem> = vscode.window.createQuickPick();
        quickPick.step = 1;
        quickPick.totalSteps = 2;
        quickPick.items = [
            { label: "Group by event and timeline", groupBy: ["event.name", "timeline.name"] },
            { label: "Group by timeline", groupBy: ["timeline.name"] },
            { label: "", kind: vscode.QuickPickItemKind.Separator},
            { label: "Custom Grouping", custom: true }
        ];

        quickPick.onDidChangeSelection(selection => {
            if (selection[0]?.groupBy) {
                quickPick.onDidHide(() => quickPick.dispose());
                quickPick.hide();
                picked(selection[0]?.groupBy);
            } else if (selection[0]?.custom) {
                quickPick.hide();
                step2();
            }
        });
        quickPick.show();
    }

    function step2() {
        const manualInput = vscode.window.createInputBox();
        manualInput.step = 2;
        manualInput.totalSteps = 2;
        manualInput.onDidAccept(() => {
            const val = manualInput.value;
            manualInput.onDidHide(() => manualInput.dispose());
            manualInput.hide();
            picked([val]);
        });
        manualInput.show();
    }

    step1();
}


export function showGraphForTimelines(timelineIds: string[], groupBy?: string[]) {
    vscode.commands.executeCommand(
        "markdown.showPreview",
        encodeUri({ type: "timelines", timelines: timelineIds, groupBy })
    );
}

export function showGraphForSegment(segmentId: modality_api.WorkspaceSegmentId, groupBy?: string[]) {
    vscode.commands.executeCommand(
        "markdown.showPreview",
        encodeUri({ type: "segment", segmentId, groupBy })
    );
}

const URI_SCHEME: string = "auxon-transition-graph";


export function encodeUri(val: TransitionGraphParams): vscode.Uri {
    return vscode.Uri.from({
        scheme: URI_SCHEME,
        path: btoa(JSON.stringify(val))
    });
}

export function decodeUri(uri: vscode.Uri): TransitionGraphParams {
    if (uri.scheme != URI_SCHEME) {
        throw new Error("Unsupported URI Scheme: " + uri.scheme);
    }

    const val = JSON.parse(atob(uri.path));
    if (val.type != "timelines" && val.type != "segment") {
        throw new Error("Unsupported 'type' in transition graph uri: " + val.type);
    }

    return val;
}

class TransitionGraphContentProvider implements vscode.TextDocumentContentProvider {
    async provideTextDocumentContent(uri: vscode.Uri, _token: vscode.CancellationToken): Promise<string> {
        var params = decodeUri(uri);

        var res: modality_api.GroupedGraph;
        var title = "# Transition graph for ";

        if (params.type == "timelines") {
            let timelinesApi = new modality_api.TimelinesApi(apiClientConfig);
            res = await timelinesApi.groupedGraph({
                timelineId: params.timelines,
                groupBy: params.groupBy
            });

            if (params.timelines.length > 1) {
                title += "selected timelines";
            } else {
                title += params.timelines[0];
            }
        } else if (params.type == "segment") {
            const workspacesApi = new modality_api.WorkspacesApi(apiClientConfig);
            res = await workspacesApi.segmentGroupedGraph({
                workspaceVersionId: params.segmentId.workspaceVersionId,
                ruleName: params.segmentId.ruleName,
                segmentName: params.segmentId.segmentName,
                groupBy: params.groupBy
            });
            title += "segment " + params.segmentId.segmentName;
        }

        if (res.nodes.length == 0) {
            return "No content";
        }

        var mermaid = "";
        mermaid += "flowchart TB\n";
        for (var i=0; i<res.nodes.length; i++) {
            const node = res.nodes[i];
            var title: string;
            if (res.attrKeys[0] == "timeline.name" && res.attrKeys[1] == "event.name") {
                title = `${node.attrVals[1]}@${node.attrVals[0]}`;
            } else {
                title = node.attrVals.join(", ");
            }

            mermaid += `  node${i}("${title} (${node.count})")\n`;
        }

        for (const edge of res.edges) {
            const sourceOccurCount = res.nodes[edge.source].count;
            const percent = (edge.count / sourceOccurCount) * 100;
            const label = `${percent.toFixed(1)}% (${edge.count})`
            mermaid += `node${edge.source}-- "${label}" -->node${edge.destination}\n`;
        }

        const content = `# ${title}\n` + 
          "```mermaid\n" + mermaid + "\n```";
        
        return content;
    }
}

