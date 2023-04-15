import * as vscode from 'vscode';
import * as util from 'util';
import * as child_process from 'child_process';

import * as modality_api from './generated-sources/modality-api';
import * as cliConfig from './cliConfig';
import * as config from './config';

const execFile = util.promisify(child_process.execFile);

export class WorkspacesTreeDataProvider implements vscode.TreeDataProvider<WorkspaceTreeItemData> {
    workspacesApi: modality_api.WorkspacesApi;
    activeWorkspaceVersionId: string;
    activeWorkspaceName: string;

    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceTreeItemData | WorkspaceTreeItemData[] | undefined > = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<WorkspaceTreeItemData | WorkspaceTreeItemData[] | undefined> = this._onDidChangeTreeData.event;

    private _onDidChangeActiveWorkspace: vscode.EventEmitter< string | undefined > = new vscode.EventEmitter();
    readonly onDidChangeActiveWorkspace: vscode.Event<string | undefined> = this._onDidChangeActiveWorkspace.event;

    constructor(apiClientConfig: modality_api.Configuration) {
        this.workspacesApi = new modality_api.WorkspacesApi(apiClientConfig);
    }

    register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.window.createTreeView("auxon.workspaces", { treeDataProvider: this }),
            vscode.commands.registerCommand("auxon.workspaces.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.workspaces.setActive", (itemData) => this.setActiveWorkspaceCommand(itemData))
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: WorkspaceTreeItemData): WorkspaceTreeItem {
        return new WorkspaceTreeItem(element);
    }

    async getChildren(_element?: WorkspaceTreeItemData): Promise<WorkspaceTreeItemData[]> {
        this.activeWorkspaceName = await cliConfig.activeWorkspaceName();
        const usedSegments = await cliConfig.usedSegments();

        let workspaces: modality_api.Workspace[] = await this.workspacesApi.listWorkspaces();
        var children = [];
        var changed = false;
        for (const workspace of workspaces) {
            children.push(
                new WorkspaceTreeItemData(
                    workspace,
                    workspace.name == this.activeWorkspaceName,
                    usedSegments.type == "WholeWorkspace"
                )
            );
            if (workspace.name == this.activeWorkspaceName) {
                if (this.activeWorkspaceVersionId != workspace.versionId) {
                    this.activeWorkspaceVersionId = workspace.versionId;
                    changed = true;
                }
            }
        }

        if (changed) {
            this._onDidChangeActiveWorkspace.fire(this.activeWorkspaceVersionId);
        }

        return children;
    }


    async setActiveWorkspaceCommand(itemData: WorkspaceTreeItemData) {
        let modality = config.toolPath("modality");
        // TODO use workspace version id for this
        await execFile(modality, ['workspace', 'use', itemData.workspace.name]);
        await execFile(modality, ['segment', 'use', '--latest']);
        this.refresh();
    }
}

export class WorkspaceTreeItemData {
    constructor(
        public workspace: modality_api.Workspace,
        public isActive: boolean,
        public isUsedAsWholeWorkspace: boolean
    ) { }
}

const ACTIVE_ITEM_MARKER = "✦";

class WorkspaceTreeItem extends vscode.TreeItem {
    contextValue = 'workspace';

    constructor( public readonly data: WorkspaceTreeItemData) {
        let tooltip = `- **Workspace Name**: ${data.workspace.name}`;
        tooltip += `\n- **Workspace Version**: ${data.workspace.versionId}`;

        if (data.isActive) {
            tooltip += `\n- **${ACTIVE_ITEM_MARKER}** This is the currently active workspace.`;
        }
        if (data.isUsedAsWholeWorkspace) {
            tooltip += `\n- **${ACTIVE_ITEM_MARKER}** The data in this workspace is the active data, as a single unit.`;
        }

        super(`${data.workspace.name}`, vscode.TreeItemCollapsibleState.None);
        this.tooltip = new vscode.MarkdownString(tooltip);

        if (data.isActive) {
            this.iconPath = new vscode.ThemeIcon("vm-active", new vscode.ThemeColor("debugIcon.startForeground"));
        } else {
            this.iconPath = new vscode.ThemeIcon("vm");
        }
    }
}


