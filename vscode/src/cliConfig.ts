/**
 * Access to configuration and state from the Modality CLI's view of the world.
 */

import * as vscode from "vscode";
import * as util from "util";
import * as child_process from "child_process";

import * as api from "./modalityApi";
import { toolPath } from "./config";

const execFile = util.promisify(child_process.execFile);

/**
 * Get the name of the current 'modality workspace use'-ed workspace.
 */
export async function activeWorkspaceName(): Promise<string> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ["workspace", "use", "--format", "json"], { encoding: "utf8" });
    return JSON.parse(res.stdout) as string;
}

export interface AllContextSegment {
    type: "All";
}
export interface WholeWorkspaceContextSegment {
    type: "WholeWorkspace";
}
export interface LatestContextSegment {
    type: "Latest";
}
export interface SetContextSegment {
    type: "Set";
    set: api.WorkspaceSegmentId[];
}
export type ContextSegment =
    | AllContextSegment
    | WholeWorkspaceContextSegment
    | LatestContextSegment
    | SetContextSegment;

/**
 * Get the current status of 'modality segment use'
 */
export async function usedSegments(): Promise<ContextSegment> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ["segment", "use", "--format", "json"], {
        encoding: "utf8",
    });

    type SegmentUseOutput = "All" | "WholeWorkspace" | "Latest" | { Set: api.WorkspaceSegmentId[] };
    const json: SegmentUseOutput = JSON.parse(res.stdout);

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

    const segmentUseRes = await execFile(modality, ["segment", "use", "--format", "json"], { encoding: "utf8" });
    const segmentUseJson = JSON.parse(segmentUseRes.stdout);
    if (segmentUseJson == "All") {
        const segmentListRes = await execFile(modality, ["segment", "list", "--detailed", "--format", "json"], { encoding: "utf8" });
        const mds = JSON.parse(segmentListRes.stdout).segments as api.WorkspaceSegmentMetadata[];
        return mds;
    }

    try {
        const res = await execFile(modality, ["segment", "inspect", "--format", "json"], { encoding: "utf8" });
        return JSON.parse(res.stdout).segments as api.WorkspaceSegmentMetadata[];
    } catch (e) {
        // This can fail if there are no segments, just return an empty list in that case rather than
        // throw an error in the UI
        return [];
    }
}

/** Read the modality CLI's auth token. */
export async function userAuthToken(): Promise<string | null> {
    const modality = toolPath("modality");
    try {
        const res = await execFile(modality, ["user", "auth-token", "--format", "json"], { encoding: "utf8" });
        return JSON.parse(res.stdout).auth_token;
    } catch (error) {
        return null;
    }
}

/** Set the modality CLI's auth token. */
export async function setUserAuthToken(authToken: string) {
    const modality = toolPath("modality");
    await execFile(modality, ["user", "auth-token", "--format", "json", "--use", authToken], { encoding: "utf8" });
}

/**
 * Get the backend URL being used by the modality cli. Remove any trailing slash or api version.
 */
export async function backendApiUrl(): Promise<vscode.Uri | null> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ["config", "--format", "json"], {
        encoding: "utf8",
    });

    interface ConfigOutput {
        modalityd?: string;
    }
    const res_json: ConfigOutput = JSON.parse(res.stdout);

    if (!res_json.modalityd) {
        return null;
    }
    const modalityd_url = vscode.Uri.parse(res_json.modalityd);

    let path = modalityd_url.path;
    if (path.endsWith("/")) {
        path = path.slice(0, -1);
    }
    if (path.endsWith("v1")) {
        path = path.slice(0, -2);
    }
    if (path.endsWith("/")) {
        path = path.slice(0, -1);
    }

    return modalityd_url.with({ path });
}

/**
 * Get the 'insecure' config flag from the CLI.
 */
export async function allowInsecureHttps(): Promise<boolean | null> {
    const modality = toolPath("modality");
    const res = await execFile(modality, ["config", "--format", "json"], {
        encoding: "utf8",
    });

    interface ConfigOutput {
        insecure?: boolean;
    }
    const res_json: ConfigOutput = JSON.parse(res.stdout);

    if (!res_json.insecure) {
        return null;
    }
    return res_json.insecure;
}
