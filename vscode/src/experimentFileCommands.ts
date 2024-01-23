import * as vscode from "vscode";
import * as path from "path";
import * as deviantCommands from "./deviantCommands";

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand("auxon.experimentFile.create", createExperiment));
}

async function createExperiment(file: vscode.Uri) {
    const experimentName = await promptForExperimentName(
        "Upload experiment file: what should this experiment be named on the server?",
        file
    );

    if (!experimentName) {
        return;
    }

    await deviantCommands.runDeviantExperimentCreateCommand({ experimentName, file });
}

async function promptForExperimentName(prompt: string, file: vscode.Uri): Promise<string | undefined> {
    const nameParts = [vscode.workspace.name];

    const p = path.parse(vscode.workspace.asRelativePath(file));
    nameParts.push(...p.dir.split(path.sep));
    nameParts.push(p.name);

    const defaultExperimentName = nameParts.join(".");
    return await vscode.window.showInputBox({ title: prompt, value: defaultExperimentName });
}
