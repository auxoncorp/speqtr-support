import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

import * as config from "./config";
import { log } from "./main";

export async function activateLspClient(context: vscode.ExtensionContext): Promise<LanguageClient> {
    const serverPath = config.toolPath("speqtr_lsp");
    log.appendLine(`Using lsp executable at ${serverPath}`);

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: {
            command: serverPath,
            transport: TransportKind.ipc,
            options: { env: await config.toolEnv() },
        },
        debug: {
            command: serverPath,
            transport: TransportKind.ipc,
            options: { env: await config.toolDebugEnv() },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "speqtr" }],
    };

    const lspClient = new LanguageClient(
        "speqtrLanguageServer",
        "SpeQTr Language Server",
        serverOptions,
        clientOptions
    );

    context.subscriptions.push(vscode.commands.registerCommand("auxon.conform.eval", runConformEvalCommand));

    // Start the client. This will also launch the server
    lspClient.start();
    return lspClient;
}

type SpecEvalCommandArgs = {
    document_uri: string;
    behavior?: string;
    dry_run: boolean;
};

function runConformEvalCommand(args: SpecEvalCommandArgs) {
    const conformPath = config.toolPath("conform");

    const commandArgs = ["spec", "eval", "--file", vscode.Uri.parse(args.document_uri).fsPath];

    if (args.behavior) {
        commandArgs.push("--behavior", args.behavior);
    }

    if (args.dry_run) {
        commandArgs.push("--dry-run");
    }

    const taskDef: vscode.TaskDefinition = {
        type: "auxon.conform.eval",
        command: conformPath,
        args: commandArgs,
    };

    const problemMatchers = ["$conformEval"];

    let scope: vscode.WorkspaceFolder;
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        scope = vscode.workspace.workspaceFolders[0];
    } else {
        throw Error("Can't run 'conform eval' without a workspace");
    }

    const exec = new vscode.ProcessExecution(taskDef.command, taskDef.args);

    const task = new vscode.Task(taskDef, scope, "conform", "conform source", exec, problemMatchers);

    task.group = vscode.TaskGroup.Build;
    task.presentationOptions = {
        echo: true,
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Dedicated,
        clear: true,
    };

    return vscode.tasks.executeTask(task);
}
