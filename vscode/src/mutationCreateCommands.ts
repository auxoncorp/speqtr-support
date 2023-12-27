import * as vscode from "vscode";
import * as config from "./config";
import * as util from "util";
import * as child_process from "child_process";

const execFile = util.promisify(child_process.execFile);

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("auxon.deviant.createMutation", runDeviantMutationCreateCommand)
    );
}

export type MutationCreateCommandArgs = {
    mutatorId?: string;
    params?: string[];
    experimentName?: string;
    // TODO - add support for the other use-cases
};

async function runDeviantMutationCreateCommand(args: MutationCreateCommandArgs) {
    const deviantPath = config.toolPath("deviant");

    const commandArgs = ["mutation", "create"];

    if (args.mutatorId) {
        commandArgs.push("--mutator-id", args.mutatorId);
    }

    if (args.experimentName) {
        commandArgs.push("--experiment", args.experimentName);
    }

    if (args.params) {
        for (const paramKeyValuePair of args.params) {
            commandArgs.push("--params", paramKeyValuePair);
        }
    }

    try {
        await execFile(deviantPath, commandArgs, { encoding: "utf8" });
    } catch (e) {
        vscode.window.showErrorMessage(e.stderr.trim());
    }
}
