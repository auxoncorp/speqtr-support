/**
 * Command handler for showing trace logs
 */

import * as vscode from "vscode";
import * as config from "./config";
import { log } from "./main";

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand(MODALITY_LOG_COMMAND, runModalityLogCommand));
}

export const MODALITY_LOG_COMMAND = "auxon.modality.log";

interface ToLogCommandArgs {
    getModalityLogCommandArgs(): ModalityLogCommandArgs;
}

export class ModalityLogCommandArgs {
    thingToLog?: string | string[];
    from?: string;
    to?: string;
    around?: string;
    radius?: string;
    segmentationRule?: string;
    segment?: string;

    public constructor(init?: Partial<ModalityLogCommandArgs>) {
        Object.assign(this, init);
    }

    getModalityLogCommandArgs(): ModalityLogCommandArgs {
        return this;
    }
}

function runModalityLogCommand(args: ToLogCommandArgs) {
    const modality = config.toolPath("modality");
    const logCommandArgs: ModalityLogCommandArgs = args.getModalityLogCommandArgs();

    // We're going to send the text of the command line to the terminal. Build up the args list here.
    const modalityArgs = ["LESS=R", modality, "log"];

    if (logCommandArgs.thingToLog) {
        if (!Array.isArray(logCommandArgs.thingToLog)) {
            logCommandArgs.thingToLog = [logCommandArgs.thingToLog];
        }

        for (const thing of logCommandArgs.thingToLog) {
            const escapedAndQuotedThingToLog = JSON.stringify(thing);
            modalityArgs.push(escapedAndQuotedThingToLog);
        }
    }

    if (logCommandArgs.from) {
        modalityArgs.push("--from", logCommandArgs.from);
    }
    if (logCommandArgs.to) {
        modalityArgs.push("--to", logCommandArgs.to);
    }
    if (logCommandArgs.around) {
        modalityArgs.push("--around", logCommandArgs.around);
    }
    if (logCommandArgs.radius) {
        modalityArgs.push("--radius", logCommandArgs.radius);
    }
    if (logCommandArgs.segmentationRule) {
        const escapedAndQuotedSegmentationRule = JSON.stringify(logCommandArgs.segmentationRule);
        modalityArgs.push("--segmentation-rule", escapedAndQuotedSegmentationRule);
    }
    if (logCommandArgs.segment) {
        const escapedAndQuotedSegment = JSON.stringify(logCommandArgs.segment);
        modalityArgs.push("--segment", escapedAndQuotedSegment);
    }

    const term: vscode.Terminal = vscode.window.createTerminal({
        name: "modality log",
        location: vscode.TerminalLocation.Editor,
    });
    term.show();

    // The `exit` makes the shell close if you hit 'q' in the pager.
    const command = `${modalityArgs.join(" ")}; exit 0\n`;
    log.appendLine(`Running modality log using command line: ${command}`);
    term.sendText(command);
}
