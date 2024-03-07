import * as vscode from "vscode";

import * as cliConfig from "./cliConfig";
import * as api from "./modalityApi";
import * as workspaceState from "./workspaceState";

export class WorkspacesTreeDataProvider implements vscode.TreeDataProvider<WorkspaceTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceTreeItemData | WorkspaceTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<WorkspaceTreeItemData | WorkspaceTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    constructor(
        private readonly apiClient: api.Client,
        private wss: workspaceState.WorkspaceAndSegmentState,
        context: vscode.ExtensionContext
    ) {
        context.subscriptions.push(
            vscode.window.createTreeView("auxon.modality_workspaces", {
                treeDataProvider: this,
            }),
            vscode.window.createTreeView("auxon.conform_workspaces", {
                treeDataProvider: this,
            }),
            vscode.window.createTreeView("auxon.deviant_workspaces", {
                treeDataProvider: this,
            }),
            vscode.commands.registerCommand("auxon.workspaces.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.workspaces.setActive", (itemData) =>
                this.setActiveWorkspaceCommand(itemData)
            ),
            wss.onDidChangeActiveWorkspace(() => this.refresh())
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: WorkspaceTreeItemData): WorkspaceTreeItem {
        return new WorkspaceTreeItem(element);
    }

    async getChildren(): Promise<WorkspaceTreeItemData[]> {
        const usedSegments = await cliConfig.usedSegments();

        const workspaces = await this.apiClient.workspaces().list();
        const children = [];
        for (const workspace of workspaces) {
            children.push(
                new WorkspaceTreeItemData(
                    workspace,
                    workspace.name == this.wss.activeWorkspaceName,
                    usedSegments.type == "WholeWorkspace"
                )
            );
        }

        return children;
    }

    async setActiveWorkspaceCommand(itemData: WorkspaceTreeItemData) {
        // TODO use workspace version id for this?
        await this.wss.setActiveWorkspaceByName(itemData.workspace.name);
    }
}

export class WorkspaceTreeItemData {
    constructor(public workspace: api.Workspace, public isActive: boolean, public isUsedAsWholeWorkspace: boolean) {}
}

const ACTIVE_ITEM_MARKER = "✦";

class WorkspaceTreeItem extends vscode.TreeItem {
    contextValue = "workspace";

    constructor(public readonly data: WorkspaceTreeItemData) {
        let tooltip = `- **Workspace Name**: ${data.workspace.name}`;
        tooltip += `\n- **Workspace Version**: ${data.workspace.version_id}`;

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
