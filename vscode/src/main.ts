import * as path from 'path';
import * as fs from 'fs';
import * as vscode from "vscode";
import { workspace, ExtensionContext } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    activateLspClient();

    const commandHandler = (args: SpecEvalCommandArgs) => {
        let commandArgs = [
            "spec", "eval",
            "--file", vscode.Uri.parse(args.document_uri).fsPath
        ];

        if (args.behavior) {
            commandArgs.push("--behavior", args.behavior);
        }

        if (args.dry_run) {
            commandArgs.push("--dry-run")
        }

        const taskDef: vscode.TaskDefinition = {
            type: "speqtr.conform",
            command: "/home/mullr/devel/modality/target/debug/conform",
            args: commandArgs
        };

        let problemMatchers = ["$conformEval"];
        const scope = vscode.workspace.workspaceFolders![0];
        const exec = new vscode.ProcessExecution(taskDef.command, taskDef.args);
        const target = vscode.workspace.workspaceFolders![0];

        let task = new vscode.Task(
            taskDef, scope, "conform", "conform source",
            exec, problemMatchers);

        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            echo: true,
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: true
        };

        return vscode.tasks.executeTask(task);
    };

    context.subscriptions.push(
        vscode.commands.registerCommand("speqtr.conform", commandHandler)
    );
}


export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

type SpecEvalCommandArgs = {
    document_uri: string,
    behavior?: string,
    dry_run: boolean,
};


function activateLspClient() {
    var serverConfig : vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("speqtr.server");

    var serverPath = serverConfig.get<null | string>("path");
    if (serverPath == null) {
        if (process.platform == "win32") {
            serverPath = "C:\\Program Files\\Auxon\\SpeqtrLsp\\speqtr_lsp.exe";
        } else {
            serverPath = "/usr/local/bin/speqtr_lsp";
            if (!fs.existsSync(serverPath)) {
                serverPath = "/usr/bin/speqtr_lsp";
            }
        }
    }

    console.info(`Using lsp executable at ${serverPath}`);

    if (!fs.existsSync(serverPath)) {
        void vscode.window.showErrorMessage(`speqtr_lsp executable not found at ${serverPath}. If you have it installed elsewhere, set the 'speqtr.server.path' configuration.`);
        return;
    }

    var extraEnv = serverConfig.get<null | object>("extraEnv");

    var env = {};
    var debugEnv = {};
    if (extraEnv != null) {
        for (const [k,v] of Object.entries(extraEnv)) {
            env[k] = v;
            debugEnv[k] = v;
        }
    }

    debugEnv['RUST_LOG'] = 'trace';
    const debugOptions = { env: debugEnv };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { command: serverPath, transport: TransportKind.ipc, options: { env: env } },
        debug: {
            command: serverPath,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'speqtr' }]
    };

    client = new LanguageClient(
        'speqtrLanguageServer',
        'SpeQTr Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start();
}