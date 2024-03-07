import * as vscode from "vscode";
import * as modalityLog from "./modalityLog";
import * as modalityEventInspect from "./modalityEventInspect";

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider({ scheme: "file", language: "speqtr" }, new SpeqtrLinkProvider())
    );
}

const EVENT_AT_TIMELINE_RE = RegExp("\\b([\\w\\?\\*]+)\\s?\\@\\s?([\\w\\?\\*.]+)", "g");

export class SpeqtrLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentLink[]> {
        const links: vscode.DocumentLink[] = [];
        for (const m of document.getText().matchAll(EVENT_AT_TIMELINE_RE)) {
            if (m.index == null) {
                continue;
            }

            {
                const link = new vscode.DocumentLink(
                    new vscode.Range(document.positionAt(m.index), document.positionAt(m.index + m[0].length))
                );
                link.tooltip = "View log for this timeline";
                const args = m[2]; // timeline name
                const cmd = vscode.Uri.parse(
                    `command:${modalityLog.MODALITY_LOG_TIMELINE_COMMAND}?${encodeURIComponent(JSON.stringify(args))}`
                );
                link.target = cmd;
                links.push(link);
            }

            {
                const link = new vscode.DocumentLink(
                    new vscode.Range(document.positionAt(m.index), document.positionAt(m.index + m[0].length))
                );
                link.tooltip = "Inspect this event";
                const event_at_timeline = `'${m[1]}'@'${m[2]}'`;
                const cmd = vscode.Uri.parse(
                    `command:${modalityEventInspect.COMMAND}?${encodeURIComponent(JSON.stringify(event_at_timeline))}`
                );
                link.target = cmd;
                links.push(link);
            }
        }
        return links;
    }

    async resolveDocumentLink(link: vscode.DocumentLink): Promise<vscode.DocumentLink> {
        return link;
    }
}
