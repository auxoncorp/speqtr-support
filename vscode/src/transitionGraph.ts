import * as vscode from "vscode";
import * as api from "./modalityApi";

export function register(context: vscode.ExtensionContext, apiClient: api.Client) {
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(URI_SCHEME, new TransitionGraphContentProvider(apiClient))
    );
}

// These will be put into the 'path' component of the uri, as base64 encoded json. Yep.
export interface TimelineParams {
    type: "timelines";
    timelines: string[];
    groupBy?: string[];
}

export interface SegmentParams {
    type: "segment";
    segmentId: api.WorkspaceSegmentId;
    groupBy?: string[];
}

export type TransitionGraphParams = TimelineParams | SegmentParams;

interface GraphGroupingItem {
    label: string;
    kind?: vscode.QuickPickItemKind;
    groupBy?: string[];
    custom?: boolean;
}

export function promptForGraphGrouping(picked: (groupBy: string[]) => void) {
    function step1() {
        const quickPick: vscode.QuickPick<GraphGroupingItem> = vscode.window.createQuickPick();
        const disposables: vscode.Disposable[] = [quickPick];

        quickPick.title = "Transition Graph: Select event grouping method";
        quickPick.items = [
            {
                label: "Group by event and timeline",
                groupBy: ["event.name", "timeline.name"],
            },
            { label: "Group by timeline", groupBy: ["timeline.name"] },
            { label: "", kind: vscode.QuickPickItemKind.Separator },
            { label: "Custom Grouping...", custom: true },
        ];

        disposables.push(
            quickPick.onDidHide(() => {
                disposables.forEach((d) => d.dispose());
            }),
            quickPick.onDidChangeSelection((selection) => {
                quickPick.hide();
                if (selection[0]?.groupBy) {
                    picked(selection[0]?.groupBy);
                } else if (selection[0]?.custom) {
                    step2();
                }
            })
        );

        quickPick.show();
    }

    function step2() {
        const manualInput = vscode.window.createInputBox();
        const disposables: vscode.Disposable[] = [manualInput];

        manualInput.title = "Transition Graph: Custom Grouping";
        manualInput.buttons = [vscode.QuickInputButtons.Back];
        manualInput.prompt =
            "Enter one or more attribute keys, separated by commas. For example: `event.name,timeline.name`";
        disposables.push(
            manualInput.onDidHide(() => {
                disposables.forEach((d) => d.dispose());
            }),
            manualInput.onDidAccept(() => {
                const val = manualInput.value;
                manualInput.hide();
                picked([val]);
            }),
            manualInput.onDidTriggerButton((item) => {
                manualInput.hide();
                if (item === vscode.QuickInputButtons.Back) {
                    step1();
                }
            })
        );
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

export function showGraphForSegment(segmentId: api.WorkspaceSegmentId, groupBy?: string[]) {
    vscode.commands.executeCommand("markdown.showPreview", encodeUri({ type: "segment", segmentId, groupBy }));
}

const URI_SCHEME = "auxon-transition-graph";

// vscode seems to equate the path portion of the document uri with
// identity pretty strongly, so we're encoding a lot of information
// into it.
export function encodeUri(val: TransitionGraphParams): vscode.Uri {
    let components: string[];
    if (val.type == "timelines") {
        components = ["timelines", val.timelines.map(encodeURIComponent).join(",")];
        if (val.groupBy && val.groupBy.length > 0) {
            components.push(val.groupBy.map(encodeURIComponent).join(","));
        }
    } else if (val.type == "segment") {
        components = [
            "segment",
            val.segmentId.workspace_version_id,
            val.segmentId.rule_name,
            val.segmentId.segment_name,
        ];

        if (val.groupBy && val.groupBy.length > 0) {
            components.push(val.groupBy.map(encodeURIComponent).join(","));
        }
    }

    return vscode.Uri.from({
        scheme: URI_SCHEME,
        path: components.join("/"),
    });
}

export function decodeUri(uri: vscode.Uri): TransitionGraphParams {
    if (uri.scheme != URI_SCHEME) {
        throw new Error("Unsupported URI Scheme: " + uri.scheme);
    }

    const components = uri.path.split("/");
    if (components[0] == "timelines") {
        const tlParams: TimelineParams = {
            type: "timelines",
            timelines: components[1].split(",").map(decodeURIComponent),
        };
        if (components[2]) {
            tlParams.groupBy = components[2].split(",").map(decodeURIComponent);
        }
        return tlParams;
    } else if (components[0] == "segment") {
        const segParams: SegmentParams = {
            type: "segment",
            segmentId: {
                workspace_version_id: components[1],
                rule_name: components[2],
                segment_name: components[3],
            },
        };
        if (components[4]) {
            segParams.groupBy = components[4].split(",").map(decodeURIComponent);
        }
        return segParams;
    } else {
        throw new Error("Unsupported 'type' in transition graph uri: " + components[0]);
    }
}

class TransitionGraphContentProvider implements vscode.TextDocumentContentProvider {
    constructor(private readonly apiClient: api.Client) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const params = decodeUri(uri);

        let res: api.GroupedGraph;
        let docTitle = "# Transition graph for ";

        if (params.type == "timelines") {
            res = await this.apiClient.timelines().groupedGraph(params.timelines, params.groupBy);
            if (params.timelines.length > 1) {
                docTitle += "selected timelines";
            } else {
                docTitle += params.timelines[0];
            }
        } else if (params.type == "segment") {
            res = await this.apiClient.segment(params.segmentId).groupedGraph(params.groupBy);
            docTitle += "segment " + params.segmentId.segment_name;
        }

        if (res.nodes.length == 0) {
            return "No content";
        }

        let mermaid = "";
        mermaid += "flowchart TB\n";
        for (let i = 0; i < res.nodes.length; i++) {
            const node = res.nodes[i];
            let title: string;
            if (res.attr_keys[0] == "timeline.name" && res.attr_keys[1] == "event.name") {
                title = `${node.attr_vals[1]}@${node.attr_vals[0]}`;
            } else if (res.attr_keys[1] == "timeline.name" && res.attr_keys[0] == "event.name") {
                title = `${node.attr_vals[0]}@${node.attr_vals[1]}`;
            } else {
                title = node.attr_vals.join(", ");
            }

            mermaid += `  node${i}("${title} (${node.count})")\n`;
        }

        for (const edge of res.edges) {
            const sourceOccurCount = res.nodes[edge.source].count;
            const percent = (edge.count / sourceOccurCount) * 100;
            const label = `${percent.toFixed(1)}% (${edge.count})`;
            mermaid += `  node${edge.source}-- "${label}" -->node${edge.destination}\n`;
        }

        const content = `# ${docTitle}\n` + "```mermaid\n" + mermaid + "\n```";

        return content;
    }
}
