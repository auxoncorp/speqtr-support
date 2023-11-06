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
                const groupBy = val.split(",").map((s) => s.trim());
                picked(groupBy);
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
    showGraph({ type: "timelines", timelines: timelineIds, groupBy });
}

export function showGraphForSegment(segmentId: api.WorkspaceSegmentId, groupBy?: string[]) {
    showGraph({ type: "segment", segmentId, groupBy });
}

function showGraph(params: TransitionGraphParams) {
    let docTitle = "Transition graph for ";

    if (params.type == "timelines") {
        if (params.timelines.length > 1) {
            docTitle += "selected timelines";
        } else {
            docTitle += params.timelines[0];
        }
    } else if (params.type == "segment") {
        docTitle += "segment " + params.segmentId.segment_name;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callback = (webpanel: any) => interactivePreviewWebpanelCallback(webpanel);

    vscode.workspace.openTextDocument(encodeUri(params)).then((doc) => {
        const options = {
            document: doc,
            title: docTitle,
            callback,
        };

        vscode.languages.setTextDocumentLanguage(doc, "dot");
        vscode.commands.executeCommand("graphviz-interactive-preview.preview.beside", options);
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function interactivePreviewWebpanelCallback(webpanel: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (message: any) => {
        return interactivePreviewMessageHandler(message);
    };
    webpanel.handleMessage = handler;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
function interactivePreviewMessageHandler(message: any) {
    // TODO: enable some basic interaction with the graph
    /*
    console.log(JSON.stringify(message));

    switch (message.command) {
        case "onClick":
            console.log("onClick");
            break;
        case "onDblClick":
            console.log("onDblClick");
            break;
        default:
            console.warn("Unexpected command: " + message.command);
    }
    */
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
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    constructor(private readonly apiClient: api.Client) {}

    get onDidChange() {
        return this._onDidChange.event;
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const params = decodeUri(uri);

        let res: api.GroupedGraph;

        if (params.type == "timelines") {
            res = await this.apiClient.timelines().groupedGraph(params.timelines, params.groupBy);
        } else if (params.type == "segment") {
            res = await this.apiClient.segment(params.segmentId).groupedGraph(params.groupBy);
        }

        if (res.nodes.length == 0) {
            // No content
            return "digraph TransitionGraph{}\n";
        }

        const hideSelfEdges = params.groupBy.length == 1 && params.groupBy[0] == "timeline.name";

        let dot = "";
        dot += "digraph TransitionGraph{\n";
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

            dot += `  node${i} [label="${title} (${node.count})"];\n`;
        }

        for (const edge of res.edges) {
            if (edge.source == edge.destination && hideSelfEdges) {
                continue;
            }

            const sourceOccurCount = res.nodes[edge.source].count;
            const percent = (edge.count / sourceOccurCount) * 100;
            const label = `${percent.toFixed(1)}% (${edge.count})`;
            dot += `  node${edge.source} -> node${edge.destination} [label="${label}"];\n`;
        }

        dot += "}\n";

        const content = dot;

        return content;
    }
}
