/**
 * Command handler for showing trace logs
 */

import * as vscode from "vscode";
import * as config from "./config";
import { log } from "./main";

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand(MODALITY_LOG_COMMAND, runModalityLogCommand));
    context.subscriptions.push(
        vscode.commands.registerCommand(MODALITY_LOG_TIMELINE_COMMAND, runModalityLogTimelineCommand)
    );
}

export const MODALITY_LOG_COMMAND = "auxon.modality.log";

// This is a single timeline shortcut because round tripping ModalityLogCommandArgs
// through a URI appears to break things
export const MODALITY_LOG_TIMELINE_COMMAND = "auxon.modality.log_timeline";

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

function runModalityLogTimelineCommand(timeline: string) {
    runModalityLogCommand(
        new ModalityLogCommandArgs({
            thingToLog: timeline,
        })
    );
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

    for (const extra of config.extraCliArgs("modality log")) {
        modalityArgs.push(extra);
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
