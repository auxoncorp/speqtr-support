import * as vscode from "vscode";
import * as util from "util";
import * as child_process from "child_process";

import * as cliConfig from "./cliConfig";
import * as api from "./modalityApi";
import * as config from "./config";

const execFile = util.promisify(child_process.execFile);

/// Track the current state of the active workspace and the used segments; dispatch
/// events related to them changing.
export class WorkspaceAndSegmentState {
    private _onDidChangeActiveWorkspace: vscode.EventEmitter<WorkspaceAndSegmentState> = new vscode.EventEmitter();
    readonly onDidChangeActiveWorkspace: vscode.Event<WorkspaceAndSegmentState> =
        this._onDidChangeActiveWorkspace.event;

    private _onDidChangeUsedSegments: vscode.EventEmitter<WorkspaceAndSegmentState> = new vscode.EventEmitter();
    readonly onDidChangeUsedSegments: vscode.Event<WorkspaceAndSegmentState> = this._onDidChangeUsedSegments.event;

    constructor(
        private apiClient: api.Client,
        public activeWorkspaceName: string,
        public activeWorkspaceVersionId: string,
        public usedSegmentConfig: cliConfig.ContextSegment,
        public activeSegments: ActiveSegments,
        public mutatorGroupingAttrs: string[]
    ) {}

    static async create(apiClient: api.Client): Promise<WorkspaceAndSegmentState> {
        const activeWorkspaceName = await cliConfig.activeWorkspaceName();

        const allWorkspaces = await apiClient.workspaces().list();
        const activeWorkspaceVersionId = allWorkspaces.find((ws) => ws.name == activeWorkspaceName)?.version_id;

        if (activeWorkspaceVersionId == null) {
            if (activeWorkspaceName == "default") {
                throw new Error("Cannot find workspace version for default workspace");
            } else {
                vscode.window.showWarningMessage(
                    `Cannot find workspace with name '${activeWorkspaceName}'.\nReverting to the default workspace.`
                );
                await _setActiveWorkspaceByNameWithLatestSegment("default");
                return WorkspaceAndSegmentState.create(apiClient);
            }
        }

        // When the default workspace is active, it may not actually be written down
        // in the CLI context dir. The CLI will produce a warning on stdout when it's
        // not explicit in some cases, which makes handling the json output more difficult.
        // This will be fixed in a future release.
        if (activeWorkspaceName == "default") {
            await _setActiveWorkspaceByName(activeWorkspaceName);
        }

        const usedSegmentConfig = await cliConfig.usedSegments();
        let activeSegments: ActiveSegments;
        switch (usedSegmentConfig.type) {
            case "WholeWorkspace":
                activeSegments = { type: "WholeWorkspace" };
                break;

            case "Set":
                activeSegments = { type: "Explicit", segmentIds: usedSegmentConfig.set, isAllSegments: false };
                break;

            case "All": {
                const workspaceSegments = await apiClient.workspace(activeWorkspaceVersionId).segments();
                activeSegments = {
                    type: "Explicit",
                    segmentIds: workspaceSegments.map((seg) => seg.id),
                    isAllSegments: true,
                };
                break;
            }

            case "Latest":
                usedSegmentConfig.type;
                activeSegments = {
                    type: "Explicit",
                    segmentIds: (await cliConfig.activeSegments()).map((meta) => meta.id),
                    isAllSegments: false,
                };
                break;

            default:
                activeSegments = { type: "Explicit", segmentIds: [], isAllSegments: false };
                break;
        }

        let resetToLatestWorkspace = false;
        if (activeSegments.type == "Explicit") {
            for (const seg of activeSegments.segmentIds) {
                if (seg.workspace_version_id != activeWorkspaceVersionId) {
                    resetToLatestWorkspace = true;
                    break;
                }
            }
        }

        if (resetToLatestWorkspace) {
            vscode.window.showWarningMessage(`Active segment is for a different workspace; reverting to latest.`);
            await _useLatestSegment();
            activeSegments = {
                type: "Explicit",
                segmentIds: (await cliConfig.activeSegments()).map((meta) => meta.id),
                isAllSegments: false,
            };
        }

        const ws_def = await apiClient.workspace(activeWorkspaceVersionId).definition();
        const mutatorGroupingAttrs = ws_def.mutator_grouping_attrs;

        return new WorkspaceAndSegmentState(
            apiClient,
            activeWorkspaceName,
            activeWorkspaceVersionId,
            usedSegmentConfig,
            activeSegments,
            mutatorGroupingAttrs
        );
    }

    async refresh() {
        const s = await WorkspaceAndSegmentState.create(this.apiClient);
        if (
            s.activeWorkspaceName != this.activeWorkspaceName ||
            s.activeWorkspaceVersionId != this.activeWorkspaceVersionId
        ) {
            this.activeWorkspaceName = s.activeWorkspaceName;
            this.activeWorkspaceVersionId = s.activeWorkspaceVersionId;

            this._onDidChangeActiveWorkspace.fire(this);
        }

        if (
            !util.isDeepStrictEqual(s.usedSegmentConfig, this.usedSegmentConfig) ||
            !util.isDeepStrictEqual(s.activeSegments, this.activeSegments)
        ) {
            this.usedSegmentConfig = s.usedSegmentConfig;
            this.activeSegments = s.activeSegments;
            this._onDidChangeUsedSegments.fire(this);
        }
    }

    async setActiveWorkspaceByName(workspaceName: string) {
        await _setActiveWorkspaceByNameWithLatestSegment(workspaceName);
        this.refresh();
    }

    isWholeWorkspaceActive(): boolean {
        return this.activeSegments.type == "WholeWorkspace";
    }

    isSegmentActive(segment: api.WorkspaceSegmentId): boolean {
        switch (this.activeSegments.type) {
            case "Explicit":
                return this.activeSegments.segmentIds.findIndex((s) => util.isDeepStrictEqual(s, segment)) != -1;
            case "WholeWorkspace":
                return false;
        }
    }

    async setActiveSegments(segments: api.WorkspaceSegmentId[]) {
        const args = ["segment", "use"];
        let ruleName: string | undefined = undefined;
        for (const segment of segments) {
            if (ruleName === undefined) {
                ruleName = segment.rule_name;
                args.push("--segmentation-rule", segment.rule_name);
            } else if (segment.rule_name != ruleName) {
                // TODO can we make this possible? Might just be a cli limitation.
                vscode.window.showWarningMessage("Segments from different segmentation rules cannot be used together.");
                return;
            }

            args.push(segment.segment_name);
        }

        for (const extra of config.extraCliArgs("modality segment use")) {
            args.push(extra);
        }

        await execFile(config.toolPath("modality"), args);
        this.refresh();
    }

    async setAllActiveSegments() {
        await execFile(config.toolPath("modality"), [
            "segment",
            "use",
            "--all-segments",
            ...config.extraCliArgs("modality segment use"),
        ]);
        this.refresh();
    }

    async useLatestSegment() {
        await _useLatestSegment();
        this.refresh();
    }

    async setWholeWorkspaceActive() {
        await execFile(config.toolPath("modality"), [
            "segment",
            "use",
            "--whole-workspace",
            ...config.extraCliArgs("modality segment use"),
        ]);
        this.refresh();
    }
}

async function _useLatestSegment() {
    await execFile(config.toolPath("modality"), [
        "segment",
        "use",
        "--latest",
        ...config.extraCliArgs("modality segment use"),
    ]);
}

async function _setActiveWorkspaceByNameWithLatestSegment(workspaceName: string) {
    const modality = config.toolPath("modality");
    await _setActiveWorkspaceByName(workspaceName);
    await execFile(modality, ["segment", "use", "--latest", ...config.extraCliArgs("modality segment use")]);
}

async function _setActiveWorkspaceByName(workspaceName: string) {
    const modality = config.toolPath("modality");
    await execFile(modality, ["workspace", "use", workspaceName, ...config.extraCliArgs("modality workspace use")]);
}

export type ActiveSegments = ExplicitActiveSegments | WholeWorkspaceActiveSegments;

/// We're in an active segment mode where we can use the segments (Set, Latest, or All)
export interface ExplicitActiveSegments {
    type: "Explicit";
    segmentIds: api.WorkspaceSegmentId[];

    /**
     * Is this all of the segments in the workspace?
     */
    isAllSegments: boolean;
}

/// We're in 'the whole workspace as one segment' mode
export interface WholeWorkspaceActiveSegments {
    type: "WholeWorkspace";
}
