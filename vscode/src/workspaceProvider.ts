/**
 * TreeData provider for the workspace tree, in the left side panel.
 */

import * as vscode from 'vscode';
import * as modality_api from './generated-sources/modality-api';
import * as cliConfig from './cliConfig';
import { isDeepStrictEqual } from 'util';

export class ModalityWorkspaceTreeDataProvider implements vscode.TreeDataProvider<WorkspaceTreeViewData> {
    workspacesApi: modality_api.WorkspacesApi;

    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceTreeViewData | WorkspaceTreeViewData[] | undefined >
        = new vscode.EventEmitter();

    readonly onDidChangeTreeData: vscode.Event<WorkspaceTreeViewData | WorkspaceTreeViewData[] | undefined>
        = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    constructor(apiClientConfig: modality_api.Configuration) {
        this.workspacesApi = new modality_api.WorkspacesApi(apiClientConfig);
    }

    getTreeItem(element: WorkspaceTreeViewData): WorkspaceTreeViewItem {
        switch(element.type) {
            case "Workspace":
                return new WorkspaceTreeItem(element);
            case "Segment":
                return new SegmentTreeItem(element)
            case "Timeline":
                return new TimelineTreeItem(element)
        }
    }

    async getChildren(element?: WorkspaceTreeViewData): Promise<WorkspaceTreeViewData[]> {
        const activeWorkspaceName = await cliConfig.activeWorkspaceName();
        const usedSegments = await cliConfig.usedSegments();

        if (element !== undefined) {
            switch (element.type) {
                case 'Workspace':
                    let workspaceSegments = await this.workspacesApi.listWorkspaceSegments({
                        workspaceVersionId: element.workspace.versionId
                    });

                    return workspaceSegments.map((segment) => {
                        var isActive = false;
                        if (usedSegments.type == "Set") {
                            isActive = usedSegments.set.some(
                                (active_seg_id) => isDeepStrictEqual(active_seg_id, segment.id)
                            );
                        } else if (usedSegments.type == "All") {
                            if (element.isActive) {
                                isActive = true;
                            }
                        }

                        return { type: 'Segment', segment, isActive };
                    });

                case 'Segment':
                    let segmentTimelines = await this.workspacesApi.listSegmentTimelines(element.segment.id);
                    return segmentTimelines.map((timeline_overview) => ({ type: 'Timeline', timeline_overview }));
            }
        } else {
            let workspaces: modality_api.Workspace[] = await this.workspacesApi.listWorkspaces();
            return workspaces.map((workspace) => ({
                type: 'Workspace',
                workspace,
                isActive: workspace.name == activeWorkspaceName,
                isUsedAsWholeWorkspace: usedSegments.type == "WholeWorkspace"
            }));
        }
    }
}

type WorkspaceTreeViewItem = WorkspaceTreeItem | SegmentTreeItem | TimelineTreeItem;
type WorkspaceTreeViewData = WorkspaceTreeItemData | SegmentTreeItemData | TimelineTreeItemData;

export type WorkspaceTreeItemData = {
    type: "Workspace",
    workspace: modality_api.Workspace,
    isActive: boolean,
    isUsedAsWholeWorkspace: boolean
}

const ACTIVE_ITEM_MARKER = "✦";

class WorkspaceTreeItem extends vscode.TreeItem {
    type: "Workspace";

    constructor( public readonly data: WorkspaceTreeItemData) {
        let marker = "";
        if (data.isActive) {
            marker = ACTIVE_ITEM_MARKER;
            if (data.isUsedAsWholeWorkspace) {
                marker += ACTIVE_ITEM_MARKER;
            }
            marker += " ";
        }

        let tooltip = `- **Workspace Name**: ${data.workspace.name}`;
        tooltip += `\n- **Workspace Version**: ${data.workspace.versionId}`;

        if (data.isActive) {
            tooltip += `\n- **${ACTIVE_ITEM_MARKER}** This is the currently active workspace.`;
        }
        if (data.isUsedAsWholeWorkspace) {
            tooltip += `\n- **${ACTIVE_ITEM_MARKER}** The data in this workspace is the active data, as a single unit.`;
        }

        super(`${marker}${data.workspace.name}`, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = new vscode.MarkdownString(tooltip);
    }

    contextValue = 'workspace';
}

export type SegmentTreeItemData = {
    type: "Segment",
    segment: modality_api.WorkspaceSegmentMetadata,
    isActive: boolean
}

class SegmentTreeItem extends vscode.TreeItem {
    type: "Segment";

    constructor(public readonly data: SegmentTreeItemData) {
        let marker = "";
        if (data.isActive) {
            marker = ACTIVE_ITEM_MARKER + " ";
        }

        const label = `${marker}${data.segment.id.segmentName}`
        super(label, vscode.TreeItemCollapsibleState.Collapsed);

        // js date is millis since the epoch; we have nanos.
        let segDate = new Date(data.segment.latestReceiveTime / 1_000_000);
        this.description = segDate.toLocaleString();

        let tooltip = `- **Segment Name**: ${data.segment.id.segmentName}`;
        tooltip += `\n- **Segmentation Rule Name**: ${data.segment.id.ruleName}`;
        if (data.isActive) {
            tooltip += `\n- **${ACTIVE_ITEM_MARKER}** This is the currently active segment.`;
        }
        this.tooltip = new vscode.MarkdownString(tooltip);
    }

    contextValue = 'segment';
}


export type TimelineTreeItemData = {
    type: "Timeline",
    timeline_overview: modality_api.TimelineOverview
}

class TimelineTreeItem extends vscode.TreeItem {
    type: "Timeline";

    constructor(public readonly data: TimelineTreeItemData) {
        let marker = "";

        const label = data.timeline_overview.name;
        super(label, vscode.TreeItemCollapsibleState.None);

        this.description = data.timeline_overview.id;

        let tooltip = `- **Timeline Name**: ${data.timeline_overview.name}`;
        tooltip += `\n- **Timeline Id**: ${data.timeline_overview.id}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }

    contextValue = 'timeline';
}
