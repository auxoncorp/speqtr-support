import * as vscode from "vscode";
import * as config from "./config";
import { log } from "./main";

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand(COMMAND, runModalityEventInspectCommand));
}

export const COMMAND = "auxon.modality.inspectEvent";

// Accepts either an event name, an event-at-timeline, or an event coordinate
function runModalityEventInspectCommand(event: string) {
    const modality = config.toolPath("modality");

    // We're going to send the text of the command line to the terminal. Build up the args list here.
    const modalityArgs = ["LESS=R", modality, "event", "inspect", event];

    for (const extra of config.extraCliArgs("modality event inspect")) {
        modalityArgs.push(extra);
    }

    const term: vscode.Terminal = vscode.window.createTerminal({
        name: "modality event inspect",
        location: vscode.TerminalLocation.Editor,
    });
    term.show();

    // The `exit` makes the shell close if you hit 'q' in the pager.
    const command = `${modalityArgs.join(" ")}; exit 0\n`;
    log.appendLine(`Running modality event inspect using command line: ${command}`);
    term.sendText(command);
}
