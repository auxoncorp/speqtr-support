/**
 * Access to configuration and state from the Modality CLI's view of the world.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as util from 'util';
import * as child_process from 'child_process';

import * as api from './modalityApi';
import { toolPath } from './config';

const execFile = util.promisify(child_process.execFile);

/**
 * Get the name of the current 'modality workspace use'-ed workspace.
 */
export async function activeWorkspaceName(): Promise<string> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ['workspace', 'use', '--format', 'json'], { encoding: 'utf8' });
    return JSON.parse(res.stdout) as string;
}

export interface AllContextSegment { type: 'All' }
export interface WholeWorkspaceContextSegment { type: 'WholeWorkspace' }
export interface LatestContextSegment { type: 'Latest' }
export interface SetContextSegment { type: 'Set', set: api.WorkspaceSegmentId[] }
export type ContextSegment = AllContextSegment | WholeWorkspaceContextSegment | LatestContextSegment | SetContextSegment;

/**
 * Get the current status of 'modality segment use'
 */
export async function usedSegments(): Promise<ContextSegment> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ['segment', 'use', '--format', 'json'], { encoding: 'utf8' });
    const json: any = JSON.parse(res.stdout);

    if (json == "All") {
        return { type: "All" };
    } else if (json == "WholeWorkspace") {
        return { type: "WholeWorkspace" };
    } else if (json == "Latest") {
        return { type: "Latest" };
    } else if (json.Set) {
        return { type: "Set", set: json.Set as api.WorkspaceSegmentId[] };
    }

    return JSON.parse(res.stdout) as ContextSegment;
}

/** 
 * Get the segment metadata for currently used segments, using 'modality segment inspect'.
 * This only works if you've previously 'modality segment use'-ed a single specific segment.
 */
export async function activeSegments(): Promise<api.WorkspaceSegmentMetadata[]> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ['segment', 'inspect', '--format', 'json'], { encoding: 'utf8' });
    return JSON.parse(res.stdout).segments as api.WorkspaceSegmentMetadata[];
}

/** Read the modality CLI's auth token. */
export function userAuthToken(): string | null {
    const authTokenPath = path.join(cliConfigDir(), ".user_auth_token");
    if (fs.statSync(authTokenPath)) {
        return fs.readFileSync(authTokenPath, 'utf8');
    } else {
        return null;
    }
}

/**
 * Get the backend URL being used by the modality cli. Remove any trailing slash or api version.
 */
export async function backendApiUrl(): Promise<vscode.Uri | null> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ['config', '--format', 'json'], { encoding: 'utf8' });
    const res_json: any = JSON.parse(res.stdout);

    if (!res_json.modalityd) { return null; }
    const modalityd_url = vscode.Uri.parse(res_json.modalityd);

    var path = modalityd_url.path;
    if (path.endsWith("/")) { path = path.slice(0, -1); }
    if (path.endsWith("v1")) { path = path.slice(0, -2); }
    if (path.endsWith("/")) { path = path.slice(0, -1); }

    return modalityd_url.with({ path });
}

/**
 * Get the 'insecure' config flag from the CLI.
 */
export async function allowInsecureHttps(): Promise<boolean | null> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ['config', '--format', 'json'], { encoding: 'utf8' });
    const res_json: any = JSON.parse(res.stdout);

    if (!res_json.insecure) { return null; }
    return res_json.insecure;
}


/**
 * Get the user-specific modality_cli config dir, for the platform
 */
function cliConfigDir(): string {
    let appConfigDir: string;
    if (os.platform() === 'win32') {
        // TODO is this right for what we do on windows?
        appConfigDir = process.env.APPDATA;
    } else if (os.platform() === 'darwin') {
        appConfigDir = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
        appConfigDir = path.join(os.homedir(), '.config');
    }
    return path.join(appConfigDir, "modality_cli");
}

