import * as vscode from "vscode";
import * as handlebars from "handlebars";
import * as api from "./modalityApi";
import * as fs from "fs";
import { Base64 } from "js-base64";

export function register(context: vscode.ExtensionContext, apiClient: api.Client) {
    const tGraphDisposable = vscode.commands.registerCommand("auxon.transition.graph", async (params) => {
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

        const webViewPanel = vscode.window.createWebviewPanel(
            "auxon.transitionGraphView",
            docTitle,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
            }
        );
        const tg = new TransitionGraph(context, apiClient);
        await tg.load(webViewPanel.webview, params);
    });
    context.subscriptions.push(tGraphDisposable);
}

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
    vscode.commands.executeCommand("auxon.transition.graph", params);
}

export class TransitionGraph {
    private extensionContext: vscode.ExtensionContext;
    private graph: DirectedGraph;

    constructor(context: vscode.ExtensionContext, private readonly apiClient: api.Client) {
        this.extensionContext = context;
    }

    async load(webview: vscode.Webview, params: TransitionGraphParams) {
        webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case "requestNodesAndEdges":
                        this.postNodesAndEdges(webview);
                        break;
                    case "saveAsPng":
                        await this.saveAsPng(message.data);
                        break;
                    default:
                }
            },
            undefined,
            this.extensionContext.subscriptions
        );

        const html = this.generateHtmlContent(webview);
        webview.html = html;

        this.graph = await this.generateGraph(params);
    }

    private postNodesAndEdges(webview: vscode.Webview) {
        const nodes = this.graph.nodes.map((node) => node.toCytoscapeObject());
        const edges = this.graph.edges
            .map((edge) => edge.toCytoscapeObject())
            .filter((edge) => Object.keys(edge).length !== 0);

        webview.postMessage({
            command: "nodesAndEdges",
            nodes,
            edges,
        });
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
        const jqueryJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "jquery.min.js")
        );
        const jqueryColorJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "jquery.color.min.js")
        );
        const codiconCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "codicon.css")
        );
        const cytoscapeJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "cytoscape.min.js")
        );
        const layoutBaseJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "layout-base.js")
        );
        const coseBaseJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "cose-base.js")
        );
        const coseBilkentJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "cytoscape-cose-bilkent.js")
        );
        const webviewUiToolkitJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "dist", "webviewuitoolkit.min.js")
        );
        const transitionGraphJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "transitionGraph.js")
        );

        const templateUri = vscode.Uri.joinPath(
            this.extensionContext.extensionUri,
            "templates",
            "transitionGraph.html"
        );
        const templateText = fs.readFileSync(templateUri.fsPath, "utf8");
        const template = handlebars.compile(templateText);

        const html = template({
            title: "Transition Graph",
            cspSource: webview.cspSource,
            nonce: this.getNonce(),
            stylesUri,
            jqueryJsUri,
            jqueryColorJsUri,
            codiconCssUri,
            cytoscapeJsUri,
            layoutBaseJsUri,
            coseBaseJsUri,
            coseBilkentJsUri,
            webviewUiToolkitJsUri,
            transitionGraphJsUri,
        });

        return html;
    }

    private async generateGraph(params: TransitionGraphParams): Promise<DirectedGraph> {
        let res: api.GroupedGraph;

        if (params.type == "timelines") {
            res = await this.apiClient.timelines().groupedGraph(params.timelines, params.groupBy);
        } else if (params.type == "segment") {
            res = await this.apiClient.segment(params.segmentId).groupedGraph(params.groupBy);
        }

        const hideSelfEdges = params.groupBy.length == 1 && params.groupBy[0] == "timeline.name";
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
            } else {
                title = node.attr_vals.join(", ");
            }

            const newNode = new Node();
            newNode.label = title;
            newNode.id = `${i}`;

            directedGraph.nodes.push(newNode);
        }

        for (const edge of res.edges) {
            if (edge.source == edge.destination && hideSelfEdges) {
                continue;
            }

            const newEdge = new Edge();

            const sourceOccurCount = res.nodes[edge.source].count;
            const percent = (edge.count / sourceOccurCount) * 100;
            const label = `${percent.toFixed(1)}% (${edge.count})`;

            newEdge.source = `${edge.source}`;
            newEdge.target = `${edge.destination}`;
            newEdge.label = label;

            directedGraph.edges.push(newEdge);
        }

        return directedGraph;
    }

    private getNonce() {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

class DirectedGraph {
    nodes: Node[];
    edges: Edge[];

    constructor() {
        this.nodes = [];
        this.edges = [];
    }
}

type PropertiesMap = Map<string, string | number | boolean>;

class Node {
    public id: string | undefined = undefined;
    public description: string | undefined = undefined;
    public filePath: vscode.Uri | undefined = undefined;
    public parent: string | undefined = undefined;
    public hasChildren = false;
    public label: string | undefined = undefined;

    public toCytoscapeObject(): object {
        const props: PropertiesMap = new Map();
        if (this.id !== undefined) {
            props.set("id", this.id);
        }
        const label = this.label.replace("'", "\\'");
        if (label !== "" && label !== undefined) {
            props.set("label", label);
        } else {
            props.set("label", this.id);
        }
        if (this.filePath !== undefined) {
            props.set("filepath", this.filePath.fsPath);
        }
        if (this.parent !== undefined) {
            props.set("parent", this.parent);
        }
        if (this.hasChildren) {
            props.set("labelvalign", "top");
        } else {
            props.set("labelvalign", "center");
        }

        const obj = { data: {} };
        for (const [k, v] of props) {
            obj.data[k] = v;
        }

        return obj;
    }
}

class Edge {
    public source: string | undefined = undefined;
    public target: string | undefined = undefined;
    public label: string | undefined = undefined;
    public visibility: boolean | undefined = undefined;

    public toCytoscapeObject(): object {
        const props: PropertiesMap = new Map();
        if (this.label !== undefined) {
            props.set("label", this.label.replace("'", "\\'"));
        }
        if (this.source !== undefined) {
            props.set("source", this.source);
        }
        if (this.target !== undefined) {
            props.set("target", this.target);
        }
        if (this.visibility !== undefined) {
            props.set("hidden", this.visibility);
        }

        const obj = { data: {} };
        for (const [k, v] of props) {
            obj.data[k] = v;
        }

        return obj;
    }
}
