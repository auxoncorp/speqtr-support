import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as specFileCommands from "./specFileCommands";


class SpecsTreeMemento {
    constructor(private readonly memento: vscode.Memento) { }

    getShowVersions(): boolean {
        return this.memento.get("specsTree_showVersions", false);
    }

    async setShowVersions(val: boolean): Promise<void> {
        return this.memento.update("specsTree_showVersions", val);
    }

    getShowResults(): boolean {
        return this.memento.get("specsTree_showResults", false);
    }

    async setShowResults(val: boolean): Promise<void> {
        return this.memento.update("specsTree_showResults", val);
    }
}


export class SpecsTreeDataProvider implements vscode.TreeDataProvider<SpecTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<SpecTreeItemData | SpecTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SpecTreeItemData | SpecTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;
    workspaceState?: SpecsTreeMemento;

    constructor(private readonly apiClient: api.Client) {}

    register(context: vscode.ExtensionContext) {
        this.workspaceState = new SpecsTreeMemento(context.workspaceState);

        context.subscriptions.push(
            vscode.window.createTreeView("auxon.specs", {
                treeDataProvider: this,
            }),
            vscode.commands.registerCommand("auxon.specs.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.specs.showVersions", () => this.showVersions(true)),
            vscode.commands.registerCommand("auxon.specs.hideVersions", () => this.showVersions(false)),
            vscode.commands.registerCommand("auxon.specs.showResults", () => this.showResults(true)),
            vscode.commands.registerCommand("auxon.specs.hideResults", () => this.showResults(false)),
            vscode.commands.registerCommand("auxon.specs.evalLatest", (item: NamedSpecTreeItemData) => this.evalLatest(item)),
            vscode.commands.registerCommand("auxon.specs.evalLatest.dryRun", (item: NamedSpecTreeItemData) => this.evalLatestDryRun(item)),
            vscode.commands.registerCommand("auxon.specs.evalVersion", (item: SpecResultTreeItemData) => this.evalVersion(item)),
            vscode.commands.registerCommand("auxon.specs.evalVersion.dryRun", (item: SpecResultTreeItemData) => this.evalVersionDryRun(item)),


            // Refresh this list any time a spec is evaluated, since it may have saved some results
            vscode.tasks.onDidEndTask(e => {
                if (e.execution.task.definition.type == "auxon.conform.eval") {
                    this.refresh();
                }
            })
        );

        this.refresh();
    }

    refresh(): void {
        vscode.commands.executeCommand(
            "setContext", "auxon.specs.versions",
            this.workspaceState.getShowVersions() ? "SHOW" : "HIDE");

        vscode.commands.executeCommand(
            "setContext", "auxon.specs.results",
            this.workspaceState.getShowResults() ? "SHOW" : "HIDE");

        this._onDidChangeTreeData.fire(undefined);
    }

    showVersions(show: boolean) {
        this.workspaceState.setShowVersions(show);
        this.refresh();
    }

    showResults(show: boolean) {
        this.workspaceState.setShowResults(show);
        this.refresh();
    }

    getTreeItem(element: SpecTreeItemData): SpecTreeItem {
        if (element instanceof NamedSpecTreeItemData) {
            return new NamedSpecTreeItem(element, this.workspaceState);
        } else if (element instanceof SpecVersionTreeItemData) {
            return new SpecVersionTreeItem(element, this.workspaceState);
        } else if (element instanceof SpecResultTreeItemData) {
            return new SpecResultTreeItem(element);
        } else if (element instanceof NoSpecResultsTreeItemData) {
            return new NoSpecResultsTreeItem();
        }
    }

    async getChildren(element?: SpecTreeItemData): Promise<SpecTreeItemData[]> {
        if (!element) {
            const specs = await this.apiClient.specs().list();
            return specs.map((spec) => new NamedSpecTreeItemData(spec.name));
        } else {
            if (element instanceof NamedSpecTreeItemData && this.workspaceState.getShowVersions()) {
                const versions = await this.apiClient.spec(element.specName).versions();
                return versions.map((versionMd) => new SpecVersionTreeItemData(versionMd.name, versionMd.version));
            }

            if (element instanceof NamedSpecTreeItemData && this.workspaceState.getShowResults() && !this.workspaceState.getShowVersions()) {
                // TODO make a single api call to get all results from a spec
                const specApi = this.apiClient.spec(element.specName);
                const versions = await specApi.versions();
                const results = [];
                for (const versionMetadata of versions) {
                    const versionResults = await specApi.version(versionMetadata.version).results();
                    results.push(...versionResults);
                }
                if (results.length == 0) {
                    return [new NoSpecResultsTreeItemData()];
                } else {
                    return results.map(
                        (result) =>
                            new SpecResultTreeItemData(
                                result.spec_name,
                                result.spec_version_id,
                                result.spec_eval_results_id
                            )
                    );
                }
            }

            if (element instanceof SpecVersionTreeItemData && this.workspaceState.getShowResults()) {
                const results = await this.apiClient.spec(element.specName).version(element.specVersion).results();
                if (results.length == 0) {
                    return [new NoSpecResultsTreeItemData()];
                } else {
                    return results.map(
                        (result) =>
                            new SpecResultTreeItemData(
                                result.spec_name,
                                result.spec_version_id,
                                result.spec_eval_results_id
                            )
                    );
                }
            }
        }
    }

    evalLatest(spec: NamedSpecTreeItemData) {
        this.conformEval({spec_name: spec.specName, dry_run: false}, true);
    }

    evalLatestDryRun(spec: NamedSpecTreeItemData) {
        this.conformEval({spec_name: spec.specName, dry_run: true}, false);
    }

    evalVersion(spec: SpecVersionTreeItemData) {
        this.conformEval({spec_version: spec.specVersion, dry_run: false}, true)
    }

    evalVersionDryRun(spec: SpecVersionTreeItemData) {
        this.conformEval({spec_version: spec.specVersion, dry_run: true}, false)
    }

    conformEval(args: specFileCommands.SpecEvalCommandArgs, refresh: boolean) {
        specFileCommands.runConformEvalCommand(args);
    }
}

export type SpecTreeItemData =
    | NamedSpecTreeItemData
    | SpecVersionTreeItemData
    | SpecResultTreeItemData
    | NoSpecResultsTreeItemData;

export type SpecTreeItem = NamedSpecTreeItem | SpecVersionTreeItem | SpecResultTreeItem | NoSpecResultsTreeItem;

export class NamedSpecTreeItemData {
    constructor(public specName: string) {}
}

class NamedSpecTreeItem extends vscode.TreeItem {
    contextValue = "spec";

    constructor(public readonly data: NamedSpecTreeItemData, workspaceData: SpecsTreeMemento) {
        super(`${data.specName}`,
        workspaceData.getShowResults() || workspaceData.getShowVersions() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    }
}

export class SpecVersionTreeItemData {
    constructor(public specName: api.SpecName, public specVersion: api.SpecVersionId) {}
}

class SpecVersionTreeItem extends vscode.TreeItem {
    contextValue = "specVersion";

    constructor(public readonly data: SpecVersionTreeItemData, workspaceData: SpecsTreeMemento) {
        super(`Spec Version: ${data.specVersion}`, 
        workspaceData.getShowResults() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    }
}

export class SpecResultTreeItemData {
    constructor(
        public specName: api.SpecName,
        public specVersion: api.SpecVersionId,
        public specEvalResultId: api.SpecEvalResultId
    ) {}
}

class SpecResultTreeItem extends vscode.TreeItem {
    contextValue = "specResult";

    constructor(public readonly data: SpecResultTreeItemData) {
        super(`Spec Result: ${data.specEvalResultId}`, vscode.TreeItemCollapsibleState.None);
    }
}

export class NoSpecResultsTreeItemData {}

class NoSpecResultsTreeItem extends vscode.TreeItem {
    contextValue = "noSpecResults";

    constructor() {
        super("No stored results for this spec");
    }
}
