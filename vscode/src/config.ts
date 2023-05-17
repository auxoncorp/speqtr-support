/**
 * Fully synthesized config access. This incorporates vscode-level configuration, in addition
 * to modality cli settings as fallbacks.
 */

import * as cliConfig from "./cliConfig";
import * as vscode from "vscode";
import * as path from 'path';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as https from 'https';
import { log } from "./main";

/**
 * The auth token that should be used to access the modality API, both directly
 * and via the CLI.
 */
export function userAuthToken(): string | null {
    const auxonConfig : vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("auxon");
    let vscodeAuthToken = auxonConfig.get<null | string>("authToken");
    if (vscodeAuthToken) {
        return vscodeAuthToken.trim();
    }

    let cliAuthToken = cliConfig.userAuthToken();
    if (cliAuthToken) {
        return cliAuthToken.trim();
    }

    return null;
}

/**
 * The url of the backend server, for v1 (CLI) api requests.
 */
export async function modalityUrlV1(): Promise<vscode.Uri> {
    return vscode.Uri.joinPath(await modalityUrl(), "v1");
}

/**
 * The url of the backend server, without any verison component. This
 * is used for OpenAPI client configuration, which already includes
 * the appropriate version component in the generated stubs.
 */
export async function modalityUrl(): Promise<vscode.Uri> {
    const auxonConfig : vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("auxon");
    let vscodeModalityUrl = auxonConfig.get<null | string>("modalityUrl");
    if (vscodeModalityUrl) {
        return vscode.Uri.parse(vscodeModalityUrl);
    }

    let cliModalityUrl = await cliConfig.backendApiUrl();
    if (cliModalityUrl) {
        return cliModalityUrl;
    }

    return vscode.Uri.parse("http://localhost:14181");
}

/**
 * Extra environment variables to use for all command invocations, including the LSP server.
 */
function extraEnv(): null | object {
    const auxonConfig : vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("auxon");
    return auxonConfig.get<null | object>("extraEnv");
}

/**
 * Should we allow insecure HTTPs connections?
 */
export async function allowInsecureHttps(): Promise<boolean> {
    const auxonConfig : vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("auxon");
    let vscodeAllow = auxonConfig.get<null | boolean>("allowInsecureHttps");
    if (vscodeAllow != null) {
        return vscodeAllow;
    }

    let cliAllow = await cliConfig.allowInsecureHttps();
    if (cliAllow != null) {
        return cliAllow;
    }

    return false;
}

/**
 * The environment used for tool invocations, include the LSP server.
 */
export async function toolEnv(): Promise<Record<string, string>> {
    var env: Record<string, string> = {
        "MODALITY_AUTH_TOKEN": userAuthToken(),
        // TODO implement this in the CLI
        "MODALITY_ALLOW_INSECURE_TLS": (await allowInsecureHttps()).toString(),
        "MODALITY_URL": (await modalityUrlV1()).toString(),
    };

    const extra = extraEnv();
    if (extra) {
        for (const [k, v] of Object.entries(extra)) {
            env[k] = v.toString();
        }
    }

    return env;
}

/**
 * The environment used for tool invocations, with diagnostics enabled.
 */
export async function toolDebugEnv(): Promise<Record<string, string>> {
    var env: Record<string, string> = await toolEnv();
    env['RUST_LOG'] = 'debug';
    return env;
}

/**
 * Return the fully qualified path to the given auxon tool executable.
 *
 * @param tool_name The name of the tool in question, without any file extension.
 * @returns The fully qualified path to the tool executable.
 * @throws Throws if the tool cannot be found.
 */
export function toolPath(tool_name: string): string {
    var auxonConfig : vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("auxon");
    var toolDir = auxonConfig.get<null | string>("tooldir");
    var toolPath: string;

    if (process.platform == "win32") {
        var customPath = null;
        if (toolDir != null) {
            customPath = path.join(toolDir, tool_name + ".exe");
        }

        toolPath = firstExistingPath(
            customPath,
            "C:\\Program Files\\Auxon\\" + tool_name + ".exe",
            "C:\\Program Files\\Auxon\\SpeqtrLsp\\" + tool_name + ".exe"
        );
    } else {
        var customPath = null;
        if (toolDir != null) {
            customPath = path.join(toolDir, tool_name);
        }

        toolPath = firstExistingPath(
            customPath,
            path.join("/usr/local/bin/", tool_name),
            path.join("/usr/bin/", tool_name)
        );
    }

    if (toolPath == null || !fs.existsSync(toolPath)) {
        let customToolMsg = "";
        if (toolDir != null) {
            customToolMsg = `${toolDir} or `;
        }

        let msg = `${tool_name} executable not found in ${customToolMsg}the default install location. ` +
            "If you have it installed elsewhere, set the 'auxon.tool.path' configuration.";
        throw new Error(msg)
    }

    return toolPath;
}

/**
 * Return the first given path which exists, or null if none of them do.
 */
function firstExistingPath(...paths: string[]): string | null {
    for (var i=0; i<paths.length; i++) {
        let path = paths[i];
        if (path == null) {
            continue;
        }

        if (fs.existsSync(path)) {
            return path;
        }
    }

    return null;
}
