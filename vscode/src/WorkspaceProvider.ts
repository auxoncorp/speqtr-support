import { openStdin } from 'process';
import * as vscode from 'vscode';
import * as api from './api';

type WorkspaceTreeData = WorkspaceData | SegmentationMethodData | SegmentData;
type WorkspaceTreeItem = WorkspaceItem | SegmentationMethodItem | SegmentItem;

export class ModalityWorkspaceTreeDataProvider implements vscode.TreeDataProvider<WorkspaceTreeData> {
    api: api.ModalityApi;
    onDidChangeTreeData?: vscode.Event<void | WorkspaceTreeData | WorkspaceTreeData[]>;

    constructor() {
        this.api = new api.ModalityApi("http://localhost:14181/v1");
    }

    getTreeItem(element: WorkspaceTreeData): WorkspaceTreeItem {
        switch(element.kind) {
            case "workspace":
                return new WorkspaceItem(element);
            case "segmentation":
                return new SegmentationMethodItem(element);
            case "segment":
                return new SegmentItem(element)
        }
    }

    async getChildren(element?: WorkspaceTreeData): Promise<WorkspaceTreeData[]> {
        if (element !== undefined) {
            switch (element.kind) {
                case 'workspace':
                    let wsDef = await this.api.getWorkspaceDefinition(element.name);
                    return Object.entries(wsDef.content.segmentation_rules)
                        .map(([name, v]) => ({ 
                            kind: 'segmentation', 
                            name, workspaceName: element.name, 
                            workspaceVersionId: element.id
                        }));

                case 'segmentation':
                    let wsSegs = await this.api.listWorkspaceSegments(element.workspaceVersionId);
                    let ruleSegs = wsSegs.filter((seg) => seg.rule_name == element.name);
                    return ruleSegs.map((seg) => ({
                        kind: 'segment',
                        name: seg.name
                    }));
                default:
                    return null;
            }
        } else {
            let nameAndIdList = await this.api.listWorkspaces();
            return nameAndIdList.map(([name, id]) => ({ kind: 'workspace', name, id }));
        }
    }
}


interface WorkspaceData {
    kind: "workspace",
    name: api.WorkspaceName,
    id: api.WorkspaceVersionId,
}

interface SegmentationMethodData {
    kind: "segmentation",
    name: api.SegmentationRuleName,
    workspaceName: api.WorkspaceName,
    workspaceVersionId: api.WorkspaceVersionId,
}

interface SegmentData {
    kind: "segment",
    name: api.WorkspaceSegmentName,
}

class WorkspaceItem extends vscode.TreeItem {
    kind: "workspace";

    constructor( public readonly data: WorkspaceData) {
        super(data.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = `${this.data.name}: ${this.data.id}`;
    }
}

class SegmentationMethodItem extends vscode.TreeItem {
    kind: "segmentation";

    constructor(public readonly data: SegmentationMethodData) {
        super(data.name, vscode.TreeItemCollapsibleState.Collapsed);
    }
}

class SegmentItem extends vscode.TreeItem {
    kind: "segment";

    constructor(public readonly data: SegmentData) {
        super(data.name, vscode.TreeItemCollapsibleState.None);
    }
}

