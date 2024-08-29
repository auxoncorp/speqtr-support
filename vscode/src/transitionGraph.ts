import * as vscode from "vscode";
import * as modalityLog from "./modalityLog";
import * as handlebars from "handlebars";
import * as api from "./modalityApi";
import * as fs from "fs";
import * as crypto from "crypto";
import { Base64 } from "js-base64";
import { getNonce } from "./webviewUtil";
import * as transitionGraphWebViewApi from "../common-src/transitionGraphWebViewApi";

export function register(context: vscode.ExtensionContext, apiClient: api.Client) {
    const tGraphDisposable = vscode.commands.registerCommand("auxon.transition.graph", async (params) => {
        let docTitle = "Transition graph for ";
        if (params.title) {
            docTitle = params.title;
        } else if (params.type == "timelines") {
            if (params.timelines.length > 1) {
                docTitle += "selected timelines";
            } else {
                docTitle += params.timelines[0];
            }
        } else if (params.type == "segment") {
            if (params.segmentIds.length == 1) {
                docTitle += "segment " + params.segmentIds[0].segment_name;
            }
        }

        const webViewPanel = vscode.window.createWebviewPanel(
            "auxon.transitionGraphView",
            docTitle,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
            }
        );

        context.subscriptions.push(
            vscode.window.onDidChangeActiveColorTheme((_) => {
                webViewPanel.webview.postMessage({ command: "themeChanged" });
            })
        );

        const tg = new TransitionGraph(context, apiClient);
        await tg.load(webViewPanel.webview, params);
    });

    context.subscriptions.push(tGraphDisposable);
}

export interface TimelineParams {
    type: "timelines";
    title?: string;
    timelines: string[];
    groupBy: string[];
    assignNodeProps?: AssignNodeProps;
    workspaceVersionId?: api.WorkspaceVersionId;
}

export interface SegmentParams {
    type: "segment";
    title?: string;
    segmentIds: [api.WorkspaceSegmentId];
    groupBy: string[];
    assignNodeProps?: AssignNodeProps;
    workspaceVersionId?: api.WorkspaceVersionId;
}

export type TransitionGraphParams = TimelineParams | SegmentParams;

export class AssignNodeProps {
    private nodeNameToClasses: { [key: string]: string[] } = {};
    private nodeNameToDataProps: { [key: string]: { [key: string]: string | number | boolean } } = {};

    addClass(nodeName: string, klass: string) {
        if (!this.nodeNameToClasses[nodeName]) {
            this.nodeNameToClasses[nodeName] = [];
        }
        const classes = this.nodeNameToClasses[nodeName];
        if (!classes.find((k) => k == klass)) {
            classes.push(klass);
        }
    }

    addDataProp(nodeName: string, key: string, val: string | number | boolean) {
        if (!this.nodeNameToDataProps[nodeName]) {
            this.nodeNameToDataProps[nodeName] = {};
        }
        const props = this.nodeNameToDataProps[nodeName];
        props[key] = val;
    }

    getClasses(nodeName: string): string[] | undefined {
        return this.nodeNameToClasses[nodeName];
    }

    getDataProps(nodeName: string): { [key: string]: string | number | boolean } | undefined {
        return this.nodeNameToDataProps[nodeName];
    }
}

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
                groupBy: ["event.name", "timeline.name", "timeline.id"],
            },
            { label: "Group by timeline", groupBy: ["timeline.name", "timeline.id"] },
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

export function showGraphForTimelines(
    timelineIds: string[],
    groupBy: string[],
    workspaceVersionId?: api.WorkspaceVersionId
) {
    showGraph({ type: "timelines", timelines: timelineIds, groupBy, workspaceVersionId });
}

export function showGraphForSegment(
    segmentId: api.WorkspaceSegmentId,
    groupBy: string[],
    workspaceVersionId?: api.WorkspaceVersionId
) {
    showGraph({ type: "segment", segmentIds: [segmentId], groupBy, workspaceVersionId });
}

function showGraph(params: TransitionGraphParams) {
    vscode.commands.executeCommand("auxon.transition.graph", params);
}

export class TransitionGraph {
    private extensionContext: vscode.ExtensionContext;
    private graph?: DirectedGraph;

    constructor(context: vscode.ExtensionContext, private readonly apiClient: api.Client) {
        this.extensionContext = context;
    }

    async load(webview: vscode.Webview, params: TransitionGraphParams) {
        webview.onDidReceiveMessage(
            async (message: transitionGraphWebViewApi.VsCodeMessage) => {
                switch (message.command) {
                    case "requestNodesAndEdges":
                        if (this.graph == null) {
                            this.graph = await this.generateGraph(params);
                        }
                        postNodesAndEdges(webview, this.graph);
                        break;

                    case "saveAsPng":
                        await this.saveAsPng(message.data);
                        break;

                    case "logSelectedNodes": {
                        vscode.commands.executeCommand(
                            "auxon.modality.log",
                            new modalityLog.ModalityLogCommandArgs({
                                thingToLog: message.thingsToLog,
                            })
                        );
                        break;
                    }
                    default:
                }
            },
            undefined,
            this.extensionContext.subscriptions
        );

        // Shows the loading indicator, until the graph shows up
        webview.html = this.generateHtmlContent(webview);
    }

    private async saveAsPng(data: string) {
        const dataUrl = data.split(",");
        const content = Base64.toUint8Array(dataUrl[1]);
        const filter = { Images: ["png"] };
        const fileUri = await vscode.window.showSaveDialog({
            saveLabel: "export",
            filters: filter,
        });
        if (fileUri) {
            try {
                await vscode.workspace.fs.writeFile(fileUri, content);
            } catch (err) {
                vscode.window.showErrorMessage(`Error on writing file: ${err}`);
            }
        }
    }

    private generateHtmlContent(webview: vscode.Webview): string {
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "transitionGraph.css")
        );

        const codiconCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "codicon.css")
        );

        const transitionGraphJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "out", "transitionGraphWebView.js")
        );

        const templateUri = vscode.Uri.joinPath(
            this.extensionContext.extensionUri,
            "resources",
            "transitionGraph.html"
        );

        const templateText = fs.readFileSync(templateUri.fsPath, "utf8");
        const template = handlebars.compile(templateText);

        const html = template({
            title: "Transition Graph",
            cspSource: webview.cspSource,
            nonce: getNonce(),
            stylesUri,
            codiconCssUri,
            transitionGraphJsUri,
        });

        return html;
    }

    private async generateGraph(params: TransitionGraphParams): Promise<DirectedGraph> {
        let res: api.GroupedGraph;

        switch (params.type) {
            case "timelines":
                res = await this.apiClient
                    .timelines()
                    .groupedGraph(params.timelines, params.groupBy, params.workspaceVersionId);
                break;
            case "segment":
                if (params.segmentIds.length == 1) {
                    res = await this.apiClient.segment(params.segmentIds[0]).groupedGraph(params.groupBy);
                } else {
                    const timelineIds: api.TimelineId[] = [];
                    // Not ideal, but okay for now #2714
                    for (const segmentId of params.segmentIds) {
                        for (const tl of await this.apiClient.segment(segmentId).timelines()) {
                            timelineIds.push(tl.id);
                        }
                    }
                    res = await this.apiClient
                        .timelines()
                        .groupedGraph(timelineIds, params.groupBy, params.workspaceVersionId);
                }
                break;
        }

        const hideSelfEdges =
            (params.groupBy.length == 1 && params.groupBy[0] == "timeline.name") ||
            (params.groupBy.length == 2 && params.groupBy[0] == "timeline.name" && params.groupBy[1] == "timeline.id");
        const directedGraph = new DirectedGraph();

        if (res.nodes.length == 0) {
            // No content
            return directedGraph;
        }

        for (let i = 0; i < res.nodes.length; i++) {
            const node = res.nodes[i];
            let title: string;
            if (res.attr_keys[0] == "timeline.name" && res.attr_keys[1] == "event.name") {
                title = `${node.attr_vals[1]}@${node.attr_vals[0]}`;
            } else if (res.attr_keys[1] == "timeline.name" && res.attr_keys[0] == "event.name") {
                title = `${node.attr_vals[0]}@${node.attr_vals[1]}`;
            } else if (res.attr_keys.length == 1 && res.attr_keys[0] == "timeline.name") {
                title = node.attr_vals[0] as string;
            } else if (
                res.attr_keys.length == 2 &&
                res.attr_keys[0] == "timeline.name" &&
                res.attr_keys[1] == "timeline.id"
            ) {
                title = node.attr_vals[0] as string;
            } else {
                title = node.attr_vals.join(", ");
            }

            const graphNode = new Node(i);
            if (node.count) {
                graphNode.count = node.count;
            }
            graphNode.label = title;

            if (params.assignNodeProps) {
                const classes = params.assignNodeProps.getClasses(title);
                if (classes) {
                    for (const c of classes) {
                        graphNode.addClass(c);
                    }
                }

                const dataProps = params.assignNodeProps.getDataProps(title);
                if (dataProps) {
                    Object.assign(graphNode, dataProps);
                }
            }

            const timelineIdIdx = res.attr_keys.indexOf("timeline.id");
            if (timelineIdIdx != -1) {
                const timelineIdAttrVal = node.attr_vals[timelineIdIdx];
                if (timelineIdAttrVal && isTimelineId(timelineIdAttrVal)) {
                    graphNode.timelineId = timelineIdAttrVal.TimelineId;
                }
            }
            const timelineNameIdx = res.attr_keys.indexOf("timeline.name");
            if (timelineNameIdx != -1) {
                graphNode.timelineName = node.attr_vals[timelineNameIdx] as string;
            }
            const eventNameIdx = res.attr_keys.indexOf("event.name");
            if (eventNameIdx != -1) {
                graphNode.eventName = node.attr_vals[eventNameIdx] as string;
            }

            directedGraph.nodes.push(graphNode);
        }

        let edgeIdx = 0;
        for (const edge of res.edges) {
            if (edge.source == edge.destination && hideSelfEdges) {
                continue;
            }

            const graphEdge = new Edge(edgeIdx, edge.source, edge.destination);
            graphEdge.count = edge.count;

            const sourceOccurCount = res.nodes[edge.source]?.count;
            if (sourceOccurCount) {
                const percent = (edge.count / sourceOccurCount) * 100;
                graphEdge.percentOfSource = `${percent.toFixed(1)}%`;
            }

            directedGraph.edges.push(graphEdge);
            edgeIdx++;
        }

        return directedGraph;
    }
}

function isTimelineId(value: api.AttrVal): value is { TimelineId?: api.TimelineId } {
    return Object.prototype.hasOwnProperty.call(value, "TimelineId");
}

function postNodesAndEdges(webview: vscode.Webview, graph: DirectedGraph) {
    if (graph === undefined) {
        return;
    }

    const nodes = graph.nodes.map((node) => node.toCytoscapeObject());
    const edges = graph.edges.map((edge) => edge.toCytoscapeObject()).filter((edge) => Object.keys(edge).length !== 0);

    webview.postMessage({
        command: "nodesAndEdges",
        nodes,
        edges,
    });
}

class DirectedGraph {
    nodes: Node[];
    edges: Edge[];

    constructor() {
        this.nodes = [];
        this.edges = [];
    }
}

class Node {
    description?: string = undefined;
    parent?: string = undefined;
    hasChildren = false;
    label?: string = undefined;
    timelineName?: string = undefined;
    timelineId?: string = undefined;
    eventName?: string = undefined;
    count?: number = undefined;
    classes: string[] = [];
    impactHtml?: string = undefined;
    severity?: number = undefined;

    constructor(public id: number) {}

    addClass(cl: string) {
        this.classes.push(cl);
    }

    toCytoscapeObject(): cytoscape.NodeDefinition {
        const data: transitionGraphWebViewApi.NodeData = { id: this.id.toString(), labelvalign: "center" };

        const label = this.label?.replace("'", "\\'");
        if (label !== undefined && label !== "") {
            data.label = label;
        } else {
            data.label = this.id.toString();
        }

        if (this.parent !== undefined) {
            data.parent = this.parent;
        }

        if (this.hasChildren) {
            data.labelvalign = "top";
        }

        // We use this to indicate nodes that can be logged from the graph context menu
        if (this.timelineId !== undefined) {
            data.timeline = this.timelineId;
        }

        if (this.timelineName !== undefined) {
            data.timelineName = this.timelineName;
        }

        if (this.eventName !== undefined) {
            data.eventName = this.eventName;
        }

        if (this.count !== undefined) {
            data.count = this.count;
        }

        if (this.impactHtml !== undefined) {
            data.impactHtml = this.impactHtml;
        }

        if (this.severity !== undefined) {
            data.severity = this.severity;
        }

        return { data: data, classes: this.classes };
    }
}

class Edge {
    uuid: string;
    label?: string = undefined;
    visibility?: boolean = undefined;
    count?: number = undefined;
    percentOfSource?: string = undefined;

    /// Source/target map to the id/index of a Node
    constructor(public id: number, public source: number, public target: number) {
        this.uuid = crypto.randomUUID();
    }

    toCytoscapeObject(): cytoscape.EdgeDefinition {
        const data: transitionGraphWebViewApi.EdgeData = {
            id: this.uuid,
            source: this.source.toString(),
            target: this.target.toString(),
        };

        if (this.label !== undefined) {
            data.label = this.label.replace("'", "\\'");
        }

        if (this.visibility !== undefined) {
            data.hidden = this.visibility;
        }

        if (this.count !== undefined) {
            data.count = this.count;
        }

        if (this.percentOfSource !== undefined) {
            data.percentOfSource = this.percentOfSource;
        }

        return { data };
    }
}
