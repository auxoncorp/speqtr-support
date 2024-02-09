import * as vscode from "vscode";
import * as fs from "fs";
import * as handlebars from "handlebars";
import * as api from "./modalityApi";
import { getNonce } from "./webviewUtil";

// N.B. to clear the details panel, provide an empty object or empty arrays
export interface ShowDetailsParams {
    events?: EventDetails[];
    timelines?: TimelineDetails[];
    interactions?: InteractionDetails[];
}

export interface InteractionDetails {
    sourceEvent?: string;
    sourceTimeline: TimelineDetails;
    destinationEvent?: string;
    destinationTimeline: TimelineDetails;
    count?: number;
}

export interface TimelineDetails {
    id: string;
    name?: string;
}

export interface EventDetails {
    name: string;
    timeline: TimelineDetails;
    count?: number;
}

export class DetailsPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "auxon.details.panelView";
    private template: HandlebarsTemplateDelegate<TemplateContext>;
    private view?: vscode.WebviewView = undefined;

    constructor(private readonly apiClient: api.Client, private readonly extensionUri: vscode.Uri) {
        const templateUri = vscode.Uri.joinPath(extensionUri, "templates", "detailsPanel.html");
        const templateText = fs.readFileSync(templateUri.fsPath, "utf8");
        this.template = handlebars.compile(templateText);
    }

    public register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(DetailsPanelProvider.viewType, this),
            vscode.commands.registerCommand("auxon.details.show", (params) => this.showDetails(params))
        );
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this.generateHtmlContent(webviewView.webview);
    }

    private generateHtmlContent(webview: vscode.Webview): string {
        const webviewUiToolkitJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "resources", "dist", "webviewuitoolkit.min.js")
        );
        const detailsPanelJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "resources", "detailsPanel.js")
        );

        const html = this.template({
            cspSource: webview.cspSource,
            nonce: getNonce(),
            webviewUiToolkitJsUri,
            detailsPanelJsUri,
        });

        return html;
    }

    private showDetails(params: ShowDetailsParams) {
        this.view.webview.postMessage(params);
    }
}

interface TemplateContext {
    cspSource: string;
    nonce: string;
    webviewUiToolkitJsUri: vscode.Uri;
    detailsPanelJsUri: vscode.Uri;
}
