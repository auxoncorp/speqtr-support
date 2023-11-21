import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as specFileCommands from "./specFileCommands";
import * as util from "util";
import * as child_process from "child_process";
import * as config from "./config";

const execFile = util.promisify(child_process.execFile);

class SpecsTreeMemento {
    constructor(private readonly memento: vscode.Memento) {}

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

export class SpecsTreeDataProvider implements vscode.TreeDataProvider<SpecsTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<SpecsTreeItemData | SpecsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SpecsTreeItemData | SpecsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;
    workspaceState?: SpecsTreeMemento;
    view: vscode.TreeView<SpecsTreeItemData>;

    constructor(private readonly apiClient: api.Client) {}

    register(context: vscode.ExtensionContext) {
        this.workspaceState = new SpecsTreeMemento(context.workspaceState);
        this.view = vscode.window.createTreeView("auxon.specs", {
            treeDataProvider: this,
            canSelectMany: true,
        });

        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.specs.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.specs.showVersions", () => this.showVersions(true)),
            vscode.commands.registerCommand("auxon.specs.hideVersions", () => this.showVersions(false)),
            vscode.commands.registerCommand("auxon.specs.showResults", () => this.showResults(true)),
            vscode.commands.registerCommand("auxon.specs.hideResults", () => this.showResults(false)),
            vscode.commands.registerCommand("auxon.specs.evalLatest", (item: NamedSpecTreeItemData) =>
                this.evalLatest(item)
            ),
            vscode.commands.registerCommand("auxon.specs.evalLatest.dryRun", (item: NamedSpecTreeItemData) =>
                this.evalLatestDryRun(item)
            ),
            vscode.commands.registerCommand("auxon.specs.evalVersion", (item: SpecVersionTreeItemData) =>
                this.evalVersion(item)
            ),
            vscode.commands.registerCommand("auxon.specs.evalVersion.dryRun", (item: SpecVersionTreeItemData) =>
                this.evalVersionDryRun(item)
            ),
            vscode.commands.registerCommand("auxon.specs.delete", (item: NamedSpecTreeItemData) =>
                this.deleteSpec(item)
            ),
            vscode.commands.registerCommand("auxon.specs.deleteMany", () => {
                const specs = this.view.selection.filter(
                    (i) => i instanceof NamedSpecTreeItemData
                ) as NamedSpecTreeItemData[];
                this.deleteSpecs(specs);
            }),

            // Refresh this list any time a spec eval is completed, since it may have saved some results
            vscode.tasks.onDidEndTask((e) => {
                if (e.execution.task.definition.type == "auxon.conform.eval") {
                    // could be more efficient here by looking for the '--dry-run' arg in the task execution
                    this.refresh();
                }
            })
        );

        this.refresh();
    }

    refresh(): void {
        vscode.commands.executeCommand(
            "setContext",
            "auxon.specs.versions",
            this.workspaceState.getShowVersions() ? "SHOW" : "HIDE"
        );

        vscode.commands.executeCommand(
            "setContext",
            "auxon.specs.results",
            this.workspaceState.getShowResults() ? "SHOW" : "HIDE"
        );

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

    getTreeItem(element: SpecsTreeItemData): vscode.TreeItem {
        return element.treeItem(this.workspaceState);
    }

    async getChildren(element?: SpecsTreeItemData): Promise<SpecsTreeItemData[]> {
        if (!element) {
            const specs = await this.apiClient.specs().list();
            return specs.map((spec) => new NamedSpecTreeItemData(spec, this.workspaceState));
        } else {
            return await element.children(this.apiClient, this.workspaceState);
        }
    }

    evalLatest(spec: NamedSpecTreeItemData) {
        this.conformEval({ spec_name: spec.specMetadata.name, dry_run: false });
    }

    evalLatestDryRun(spec: NamedSpecTreeItemData) {
        this.conformEval({ spec_name: spec.specMetadata.name, dry_run: true });
    }

    evalVersion(spec: SpecVersionTreeItemData) {
        this.conformEval({ spec_version: spec.specVersion, dry_run: false });
    }

    evalVersionDryRun(spec: SpecVersionTreeItemData) {
        this.conformEval({ spec_version: spec.specVersion, dry_run: true });
    }

    async deleteSpec(spec: NamedSpecTreeItemData) {
        const answer = await vscode.window.showInformationMessage(
            `Really delete spec '${spec.specMetadata.name}'? This will delete all spec versions and stored results.`,
            "Delete",
            "Cancel"
        );
        if (answer == "Delete") {
            const conform = config.toolPath("conform");
            await execFile(conform, ["spec", "delete", spec.specMetadata.name, "--force"], { encoding: "utf8" });
            this.refresh();
        }
    }

    async deleteSpecs(specs: NamedSpecTreeItemData[]) {
        const answer = await vscode.window.showInformationMessage(
            `Really delete ${specs.length} specs? This will delete all spec versions and stored results.`,
            "Delete",
            "Cancel"
        );
        if (answer == "Delete") {
            const conform = config.toolPath("conform");
            for (const spec of specs) {
                await execFile(conform, ["spec", "delete", spec.specMetadata.name, "--force"], { encoding: "utf8" });
            }
            this.refresh();
        }
    }

    conformEval(args: specFileCommands.SpecEvalCommandArgs) {
        specFileCommands.runConformEvalCommand(args);
    }
}

// This is the base of all the tree item data classes
abstract class SpecsTreeItemData {
    abstract contextValue: string;

    description?: string = undefined;
    tooltip?: vscode.MarkdownString = undefined;
    iconPath?: vscode.ThemeIcon = undefined;

    constructor(public name: string) {}

    treeItem(workspaceData: SpecsTreeMemento): vscode.TreeItem {
        let state = vscode.TreeItemCollapsibleState.Collapsed;
        if (!this.canHaveChildren(workspaceData)) {
            state = vscode.TreeItemCollapsibleState.None;
        }

        const item = new vscode.TreeItem(this.name, state);
        item.contextValue = this.contextValue;
        item.description = this.description;
        item.tooltip = this.tooltip;
        item.iconPath = this.iconPath;

        return item;
    }

    canHaveChildren(_workspaceData: SpecsTreeMemento): boolean {
        return false;
    }

    async children(_apiClient: api.Client, _workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        return [];
    }
}

export class NamedSpecTreeItemData extends SpecsTreeItemData {
    contextValue = "spec";
    constructor(public specMetadata: api.SpecVersionMetadata, workspaceState: SpecsTreeMemento) {
        super(specMetadata.name);
        if (workspaceState.getShowResults() || workspaceState.getShowVersions()) {
            super.iconPath = new vscode.ThemeIcon("file", new vscode.ThemeColor("symbolIcon.fileForeground"));
        } else {
            // TODO color this based on if it has been executed, and if it was successful or not
            // Icons: Verified or verified-filled (It passed) / Unverified (I haven't run it) / hacked up version of verified-filled for unsuccessful
            super.iconPath = new vscode.ThemeIcon("unverified");
        }
    }

    override canHaveChildren(_workspaceData: SpecsTreeMemento): boolean {
        return true;
    }

    override async children(apiClient: api.Client, workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        const specApi = apiClient.spec(this.specMetadata.name);
        const children = [];

        const structure = await specApi.structure();
        if (structure.attributes) {
            removeNamesFromAttrMap(structure.attributes);
            if (Object.keys(structure.attributes).length > 0) {
                children.push(new MetadataTreeItemData(structure.attributes));
            }
        }

        if (structure.behaviors) {
            for (const [behaviorName, behaviorStructure] of structure.behaviors) {
                children.push(new BehaviorTreeItemData(behaviorName, behaviorStructure));
            }
        }

        if (workspaceState.getShowVersions()) {
            children.push(new SpecVersionsTreeItemData(this.specMetadata.name));
        } else if (workspaceState.getShowResults()) {
            children.push(new SpecResultsTreeItemData(this.specMetadata.name, this.specMetadata.version));
        }

        return children;
    }
}

export class MetadataTreeItemData extends SpecsTreeItemData {
    contextValue = "specMetadata";
    constructor(public attributeMap: api.AttributeMap) {
        super("Metadata");
        // icon: comment? tag?
        super.iconPath = new vscode.ThemeIcon("output");
    }

    override canHaveChildren(_workspaceData: SpecsTreeMemento): boolean {
        return true;
    }

    override async children(_apiClient: api.Client, _workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        return Object.entries(this.attributeMap).map(([key, val]) => new AttrKVTreeItemData(key, val));
    }
}

export class AttrKVTreeItemData extends SpecsTreeItemData {
    contextValue = "specMetadata";
    constructor(public key: api.AttrKey, public val: api.AttrVal) {
        super(`${key}: ${val}`);
        if (key == "spec.author") {
            super.iconPath = new vscode.ThemeIcon("person");
        } else {
            super.iconPath = new vscode.ThemeIcon("tag");
        }
    }
}

export class SpecVersionsTreeItemData extends SpecsTreeItemData {
    contextValue = "specVersions";
    constructor(public specName: string) {
        super("Versions");
        super.iconPath = new vscode.ThemeIcon("versions", new vscode.ThemeColor("symbolIcon.constructorForeground"));
    }

    override canHaveChildren(_workspaceData: SpecsTreeMemento): boolean {
        return true;
    }

    override async children(apiClient: api.Client, workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        const versions = await apiClient.spec(this.specName).versions();
        return versions.map(
            (versionMd) => new SpecVersionTreeItemData(versionMd.name, versionMd.version, workspaceState)
        );
    }
}

export class SpecVersionTreeItemData extends SpecsTreeItemData {
    contextValue = "specVersion";
    constructor(
        public specName: api.SpecName,
        public specVersion: api.SpecVersionId,
        workspaceState: SpecsTreeMemento
    ) {
        super("Spec Version: " + specVersion);
        if (workspaceState.getShowResults()) {
            super.iconPath = new vscode.ThemeIcon("file", new vscode.ThemeColor("symbolIcon.constructorForeground"));
        } else {
            // TODO color this based on if it has been executed, and if it was successful or not
            // Icons: Verified or verified-filled (It passed) / Unverified (I haven't run it) / hacked up version of verified-filled for unsuccessful
            super.iconPath = new vscode.ThemeIcon("file", new vscode.ThemeColor("symbolIcon.constructorForeground"));
        }
    }

    override canHaveChildren(workspaceData: SpecsTreeMemento): boolean {
        return workspaceData.getShowResults();
    }

    override async children(apiClient: api.Client, workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        if (workspaceState.getShowResults()) {
            const results = await apiClient.spec(this.specName).version(this.specVersion).results();
            if (results.length == 0) {
                return [new NoSpecResultsTreeItemData()];
            } else {
                return results.map((result) => new SpecResultTreeItemData(result));
            }
        }
    }
}

export class SpecResultsTreeItemData extends SpecsTreeItemData {
    contextValue = "specResults";
    constructor(public specName: api.SpecName, public specVersion: api.SpecVersionId) {
        super("Results");
        super.iconPath = new vscode.ThemeIcon("graph");
    }

    override canHaveChildren(_workspaceData: SpecsTreeMemento): boolean {
        return true;
    }

    override async children(apiClient: api.Client, _workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        const results = await apiClient.spec(this.specName).version(this.specVersion).results();
        if (results.length == 0) {
            return [new NoSpecResultsTreeItemData()];
        } else {
            return results.map((result) => new SpecResultTreeItemData(result));
        }
    }
}

export class SpecResultTreeItemData extends SpecsTreeItemData {
    contextValue = "specResult";
    constructor(public evalOutcome: api.SpecEvalOutcomeHighlights) {
        super("Spec Result: " + evalOutcome.spec_eval_results_id);
        if (evalOutcome.regions_failing > 0) {
            super.iconPath = new vscode.ThemeIcon("testing-failed-icon");
        } else {
            super.iconPath = new vscode.ThemeIcon("testing-passed-icon");
        }
    }
}

export class NoSpecResultsTreeItemData extends SpecsTreeItemData {
    contextValue = "noSpecResults";
    constructor() {
        super("No stored results for this spec");
    }
}

function removeNamesFromAttrMap(attrs: api.AttributeMap) {
    delete attrs["behavior.name"];
    delete attrs["when.name"];
    delete attrs["until.name"];
    delete attrs["case.name"];
}

export class BehaviorTreeItemData extends SpecsTreeItemData {
    contextValue = "specBehavior";
    constructor(public behaviorName: string, public structure: api.BehaviorStructure) {
        super(`Behavior: ${behaviorName}`);
        super.iconPath = new vscode.ThemeIcon("pulse", new vscode.ThemeColor("symbolIcon.classForeground"));
    }

    override canHaveChildren(_workspaceData: SpecsTreeMemento): boolean {
        return true;
    }

    override async children(_apiClient: api.Client, _workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        const children = [];
        if (this.structure.attributes) {
            removeNamesFromAttrMap(this.structure.attributes);
            if (Object.keys(this.structure.attributes).length > 0) {
                children.push(new MetadataTreeItemData(this.structure.attributes));
            }
        }

        if (this.structure.when) {
            const [name, attributes] = this.structure.when;
            removeNamesFromAttrMap(attributes);
            children.push(new WhenTreeItemData(name, attributes));
        }

        if (this.structure.until) {
            const [name, attributes] = this.structure.until;
            removeNamesFromAttrMap(attributes);
            children.push(new UntilTreeItemData(name, attributes));
        }

        for (const [name, type, attrs] of this.structure.cases) {
            removeNamesFromAttrMap(attrs);
            children.push(new CaseTreeItemData(name, type, attrs));
        }

        return children;
    }
}

abstract class BehaviorItemTreeItemData extends SpecsTreeItemData {
    constructor(public kindLabel: string, public itemName: string, public attributeMap: api.AttributeMap) {
        super(`${kindLabel}: ${itemName}`);
    }

    metadataKvs(): [string, api.AttrVal][] {
        return Object.entries(this.attributeMap);
    }

    override canHaveChildren(_workspaceData: SpecsTreeMemento): boolean {
        return this.metadataKvs().length > 0;
    }

    override async children(_apiClient: api.Client, _workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        return this.metadataKvs().map(([key, val]) => new AttrKVTreeItemData(key, val));
    }
}

class WhenTreeItemData extends BehaviorItemTreeItemData {
    contextValue = "specBehaviorWhen";
    constructor(itemName: string, attributeMap: api.AttributeMap) {
        super("When", itemName, attributeMap);
        super.iconPath = new vscode.ThemeIcon("git-compare", new vscode.ThemeColor("symbolIcon.fieldForeground"));
    }
}

class UntilTreeItemData extends BehaviorItemTreeItemData {
    contextValue = "specBehaviorUntil";
    constructor(itemName: string, attributeMap: api.AttributeMap) {
        super("Until", itemName, attributeMap);
        super.iconPath = new vscode.ThemeIcon(
            "git-pull-request-closed",
            new vscode.ThemeColor("symbolIcon.fieldForeground")
        );
    }
}

// bracket-dot: recovery case, bracket-error: prohibited case, bracket: nominal case
class CaseTreeItemData extends BehaviorItemTreeItemData {
    contextValue = "specBehaviorCase";
    constructor(itemName: string, type: api.BehaviorCaseType, attributeMap: api.AttributeMap) {
        super(`${type} case`, itemName, attributeMap);
        switch (type) {
            case "Nominal":
                super.iconPath = new vscode.ThemeIcon("bracket", new vscode.ThemeColor("symbolIcon.fieldForeground"));
                break;
            case "Recovery":
                super.iconPath = new vscode.ThemeIcon(
                    "bracket-dot",
                    new vscode.ThemeColor("symbolIcon.fieldForeground")
                );
                break;
            case "Prohibited":
                super.iconPath = new vscode.ThemeIcon(
                    "bracket-error",
                    new vscode.ThemeColor("symbolIcon.fieldForeground")
                );
                break;
        }
    }
}
