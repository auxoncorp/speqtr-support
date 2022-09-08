import * as path from 'path';
import * as fs from 'fs';
import * as vscode from "vscode";
import { workspace, ExtensionContext } from 'vscode';
import { ModalityWorkspaceTreeDataProvider } from './WorkspaceProvider'; 'WorkspaceProvider';



import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

console.log("load");


export function activate(context: ExtensionContext) {
    console.log("activate");

	// vscode.window.registerTreeDataProvider('modalityWorkspaces', new ModalityWorkspaceTreeDataProvider());
	vscode.window.createTreeView('modalityWorkspaces', {
		treeDataProvider: new ModalityWorkspaceTreeDataProvider()
	});

    var serverConfig : vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("speqtr.server");

    var serverPath = serverConfig.get<null | string>("path");
    if (serverPath == null) {
        if (process.platform == "win32") {
            serverPath = "C:\\Program Files\\Auxon\\SpeqtrLsp\\speqtr-lsp.exe";
        } else {
            serverPath = "/usr/local/bin/speqtr-lsp";
            if (!fs.existsSync(serverPath)) {
                serverPath = "/usr/bin/speqtr-lsp";
            }
        }   
    }

    console.info(`Using lsp executable at ${serverPath}`);

    if (!fs.existsSync(serverPath)) {
        void vscode.window.showErrorMessage(`speqtr-lsp executable not found at ${serverPath}. If you have it installed elsewhere, set the 'speqtr.server.path' configuration.`);
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

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
