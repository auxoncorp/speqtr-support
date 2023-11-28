import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

import * as config from "./config";
import { log } from "./main";

export async function activateLspClient(_context: vscode.ExtensionContext): Promise<LanguageClient> {
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

    // Start the client. This will also launch the server
    lspClient.start();
    return lspClient;
}
