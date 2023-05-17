import * as vscode from "vscode";
import * as modalityLog from "./modalityLog";

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.window.registerTerminalLinkProvider(EVENT_COORDS_TERMINAL_LINK_PROVIDER));
}

const EVENT_COORDS_RE_STR: string = "%[0-9a-f]{32}:[0-9a-f]+";
// Look for '..' ahead and behind, so we don't  match part of a coord..coord range
const EVENT_COORDS_RE: RegExp = RegExp(`(?<!\\.\\.)(${EVENT_COORDS_RE_STR})(\\.\\.)?`, "g");
const EVENT_COORDS_RANGE_RE: RegExp = RegExp(`(${EVENT_COORDS_RE_STR})\\.\\.(${EVENT_COORDS_RE_STR})`, "g");

const EVENT_COORDS_TERMINAL_LINK_PROVIDER: vscode.TerminalLinkProvider = {
    provideTerminalLinks: (context: vscode.TerminalLinkContext, _token: vscode.CancellationToken) => {
        var links = [];

        for (const match of context.line.matchAll(EVENT_COORDS_RE)) {
            if (match[2] == "..") {
                continue;
            }

            const coord = match[1];
            links.push({
                startIndex: match.index,
                length: match[0].length,
                tooltip: "View log around this event",
                data: { around: coord, radius: 5 },
            });
        }

        for (const match of context.line.matchAll(EVENT_COORDS_RANGE_RE)) {
            const firstCoord = match[1];
            const secondCoord = match[2];

            links.push({
                startIndex: match.index,
                length: match[0].length,
                tooltip: "View log of this causal region",
                data: { from: firstCoord, to: secondCoord },
            });
        }

        return links;
    },
    handleTerminalLink: (link: any) => {
        vscode.commands.executeCommand(
            modalityLog.MODALITY_LOG_COMMAND,
            new modalityLog.ModalityLogCommandArgs({
                around: link.data.around,
                radius: link.data.radius,
                from: link.data.from,
                to: link.data.to,
            })
        );
    },
};
