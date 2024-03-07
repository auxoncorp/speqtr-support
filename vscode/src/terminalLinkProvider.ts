import * as vscode from "vscode";
import * as modalityLog from "./modalityLog";

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.window.registerTerminalLinkProvider(EVENT_COORDS_TERMINAL_LINK_PROVIDER));
}

const EVENT_COORDS_RE_STR = "%[0-9a-f]{32}:[0-9a-f]+";
// Look for '..' ahead and behind, so we don't  match part of a coord..coord range
const EVENT_COORDS_RE = RegExp(`(?<!\\.\\.)(${EVENT_COORDS_RE_STR})(\\.\\.)?`, "g");
const EVENT_COORDS_RANGE_RE = RegExp(`(${EVENT_COORDS_RE_STR})\\.\\.(${EVENT_COORDS_RE_STR})`, "g");

interface EventCoordsTerminalLink {
    startIndex: number;
    length: number;
    tooltip?: string;
    data: EventCoordsTerminalLinkData;
}

interface EventCoordsTerminalLinkData {
    around?: string;
    radius?: string;
    from?: string;
    to?: string;
}

const EVENT_COORDS_TERMINAL_LINK_PROVIDER: vscode.TerminalLinkProvider<EventCoordsTerminalLink> = {
    provideTerminalLinks: (context: vscode.TerminalLinkContext) => {
        const links = [];

        for (const match of context.line.matchAll(EVENT_COORDS_RE)) {
            if (match[2] == "..") {
                continue;
            }

            const coord = match[1];
            if (match.index == null) {
                continue;
            }

            const link: EventCoordsTerminalLink = {
                startIndex: match.index,
                length: match[0].length,
                tooltip: "View log around this event",
                data: { around: coord, radius: "5" },
            };
            links.push(link);
        }

        for (const match of context.line.matchAll(EVENT_COORDS_RANGE_RE)) {
            const firstCoord = match[1];
            const secondCoord = match[2];
            if (match.index == null) {
                continue;
            }

            const link: EventCoordsTerminalLink = {
                startIndex: match.index,
                length: match[0].length,
                tooltip: "View log of this causal region",
                data: { from: firstCoord, to: secondCoord },
            };
            links.push(link);
        }

        return links;
    },

    handleTerminalLink: (link: EventCoordsTerminalLink) => {
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
