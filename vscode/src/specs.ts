import * as vscode from 'vscode';
import * as api from './modalityApi';

export class SpecsTreeDataProvider implements vscode.TreeDataProvider<SpecTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<SpecTreeItemData | SpecTreeItemData[] | undefined > = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SpecTreeItemData | SpecTreeItemData[] | undefined> = this._onDidChangeTreeData.event;

    constructor(private readonly apiClient: api.Client) { }

    register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.window.createTreeView("auxon.specs", { treeDataProvider: this }),
            vscode.commands.registerCommand("auxon.specs.refresh", () => this.refresh()),
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SpecTreeItemData): SpecTreeItem {
        if (element instanceof NamedSpecTreeItemData) {
            return new NamedSpecTreeItem(element);
        } else if (element instanceof SpecVersionTreeItemData) {
            return new SpecVersionTreeItem(element);
        } else if (element instanceof SpecResultTreeItemData) {
            return new SpecResultTreeItem(element);
        }
    }

    async getChildren(element?: SpecTreeItemData): Promise<SpecTreeItemData[]> {
        if (!element) {
            const specs = await this.apiClient.specs().list();
            return specs.map(spec => new NamedSpecTreeItemData(spec.name));
        } else {
            if (element instanceof NamedSpecTreeItemData) {
                const versions = await this.apiClient.spec(element.specName).versions();
                return versions.map(versionMd => new SpecVersionTreeItemData(versionMd.name, versionMd.version));
            } else if (element instanceof SpecVersionTreeItemData) {
                const results = await this.apiClient.spec(element.specName).version(element.specVersion).results();
                return results.map(result => new SpecResultTreeItemData(result.spec_name, result.spec_version_id, result.spec_eval_results_id));
            } else if (element instanceof SpecResultTreeItemData) {
                return [];
            }
        }
    }
}


export type SpecTreeItemData = NamedSpecTreeItemData | SpecVersionTreeItemData | SpecResultTreeItemData;
export type SpecTreeItem = NamedSpecTreeItem | SpecVersionTreeItem | SpecResultTreeItem;

export class NamedSpecTreeItemData {
    constructor(public specName: string) { }
}

class NamedSpecTreeItem extends vscode.TreeItem {
    contextValue = 'spec';

    constructor( public readonly data: NamedSpecTreeItemData) {
        super(`${data.specName}`, vscode.TreeItemCollapsibleState.Collapsed);
    }
}


export class SpecVersionTreeItemData {
    constructor(
        public specName: api.SpecName,
        public specVersion: api.SpecVersionId,
    ) { }
}

class SpecVersionTreeItem extends vscode.TreeItem {
    contextValue = 'specVersion';

    constructor( public readonly data: SpecVersionTreeItemData) {
        super(`Spec Version: ${data.specVersion}`, vscode.TreeItemCollapsibleState.Collapsed);
    }
}


export class SpecResultTreeItemData {
    constructor(
        public specName: api.SpecName,
        public specVersion: api.SpecVersionId,
        public specEvalResultId: api.SpecEvalResultId
    ) { }
}

class SpecResultTreeItem extends vscode.TreeItem {
    contextValue = 'specResult';

    constructor( public readonly data: SpecResultTreeItemData) {
        super(`Spec Result: ${data.specEvalResultId}`, vscode.TreeItemCollapsibleState.None);
    }
}