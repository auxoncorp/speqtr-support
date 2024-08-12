import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as specFileCommands from "./specFileCommands";
import * as util from "util";
import * as child_process from "child_process";
import * as config from "./config";
import * as specCoverage from "./specCoverage";
import * as cliConfig from "./cliConfig";
import * as workspaceState from "./workspaceState";

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
    uiState: SpecsTreeMemento;
    view: vscode.TreeView<SpecsTreeItemData>;
    data: SpecsTreeItemData[] = [];

    constructor(
        private readonly apiClient: api.Client,
        private readonly cov: specCoverage.SpecCoverageProvider,
        private wss: workspaceState.WorkspaceAndSegmentState,
        context: vscode.ExtensionContext
    ) {
        this.uiState = new SpecsTreeMemento(context.workspaceState);
        this.view = vscode.window.createTreeView("auxon.specs", {
            treeDataProvider: this,
            canSelectMany: true,
        });

        const coverage = this.coverage.bind(this);

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
            vscode.commands.registerCommand("auxon.specs.showLatest", (item: NamedSpecTreeItemData) =>
                this.showLatest(item)
            ),
            vscode.commands.registerCommand("auxon.specs.showVersion", (item: SpecVersionTreeItemData) =>
                this.showVersion(item)
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
            vscode.commands.registerCommand("auxon.specs.coverage", coverage),
            vscode.commands.registerCommand("auxon.specs.coverage.spec", coverage),
            vscode.commands.registerCommand("auxon.specs.coverage.manySpecs", coverage),
            vscode.commands.registerCommand("auxon.specs.coverage.version", coverage),
            vscode.commands.registerCommand("auxon.specs.coverage.manyVersions", coverage),
            vscode.commands.registerCommand("auxon.specs.coverage.result", coverage),
            vscode.commands.registerCommand("auxon.specs.coverage.manyResults", coverage),
            vscode.commands.registerCommand("auxon.specs.revealSpec", (specName) => {
                this.revealSpec(specName);
            }),

            // Refresh this list any time a spec eval is completed, since it may have saved some results
            vscode.tasks.onDidEndTask((e) => {
                if (e.execution.task.definition.type == "auxon.conform.eval") {
                    // could be more efficient here by looking for the '--dry-run' arg in the task execution
                    this.refresh();
                }
            }),
            this.wss.onDidChangeUsedSegments(() => this.refresh())
        );

        this.refresh();
    }

    refresh(): void {
        vscode.commands.executeCommand(
            "setContext",
            "auxon.specs.versions",
            this.uiState.getShowVersions() ? "SHOW" : "HIDE"
        );

        vscode.commands.executeCommand(
            "setContext",
            "auxon.specs.results",
            this.uiState.getShowResults() ? "SHOW" : "HIDE"
        );

        this._onDidChangeTreeData.fire(undefined);
    }

    revealSpec(specName: string) {
        const item = this.data.find((i) => i.contextValue == "spec" && i.name == specName);
        if (item) {
            this.view.reveal(item, { focus: true, select: true, expand: 10 });
        }
    }

    showVersions(show: boolean) {
        this.uiState.setShowVersions(show);
        this.refresh();
    }

    showResults(show: boolean) {
        this.uiState.setShowResults(show);
        this.refresh();
    }

    getTreeItem(element: SpecsTreeItemData): vscode.TreeItem {
        return element.treeItem(this.uiState);
    }

    async getChildren(element?: SpecsTreeItemData): Promise<SpecsTreeItemData[]> {
        const children = await this.getChildrenInner(element);
        if (children.length === 0) {
            this.view.message =
                "No specs available. Create a new SpeQTr file or upload an existing one to get started.";
        } else {
            this.view.message = undefined;
        }
        return children;
    }

    private async getChildrenInner(element?: SpecsTreeItemData): Promise<SpecsTreeItemData[]> {
        if (!element) {
            this.data = [];
            const specs = await this.apiClient.specs().list();
            const evalSummaries: api.SpecSegmentEvalOutcomeSummary[] = [];
            const showResultsOrVersions = this.uiState.getShowResults() || this.uiState.getShowVersions();
            if (!showResultsOrVersions && this.wss.activeSegments) {
                if (this.wss.activeSegments.type == "Explicit") {
                    for (const seg of this.wss.activeSegments.segmentIds) {
                        evalSummaries.push(...(await this.apiClient.segment(seg).specSummary()));
                    }
                }
            }
            const items = await Promise.all(
                specs.map(async (spec) => {
                    const summary = evalSummaries.find((s) => s.spec_name == spec.name);
                    const icon = getNamedSpecIcon(summary);
                    return new NamedSpecTreeItemData(spec, icon);
                })
            );

            const { compare } = Intl.Collator("en-US");
            this.data = items.sort((a, b) => compare(a.name, b.name));
            return this.data;
        } else {
            return await element.children(this.apiClient, this.uiState);
        }
    }

    getParent(_element: SpecsTreeItemData): vscode.ProviderResult<SpecsTreeItemData> {
        // We only ever expose the root elements for selection in revealSpec
        return undefined;
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

    async showLatest(spec: NamedSpecTreeItemData) {
        await this.showSpec(spec.specMetadata.name);
    }

    async showVersion(spec: SpecVersionTreeItemData) {
        await this.showSpec(spec.specVersion);
    }

    async deleteSpec(spec: NamedSpecTreeItemData) {
        const answer = await vscode.window.showInformationMessage(
            `Really delete spec '${spec.specMetadata.name}'? This will delete all spec versions and stored results.`,
            "Delete",
            "Cancel"
        );
        if (answer == "Delete") {
            const conform = config.toolPath("conform");
            await execFile(
                conform,
                ["spec", "delete", spec.specMetadata.name, "--force", ...config.extraCliArgs("conform spec delete")],
                { encoding: "utf8" }
            );
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
                await execFile(
                    conform,
                    [
                        "spec",
                        "delete",
                        spec.specMetadata.name,
                        "--force",
                        ...config.extraCliArgs("conform spec delete"),
                    ],
                    { encoding: "utf8" }
                );
            }
            this.refresh();
        }
    }

    async coverage(item: SpecsTreeItemData) {
        const activeSegments = await cliConfig.activeSegments();
        if (activeSegments.length > 1) {
            throw new Error("Can't currently show coverage for multiple segments at once");
        } else if (activeSegments.length == 0) {
            throw new Error("No segments are active");
        }

        const params: specCoverage.SpecCoverageParams = {
            segmentId: activeSegments[0].id,
        };

        // consider the clicked item to be part of the selection for
        // the purposes of choosing coverage inputs
        const selection = [...this.view.selection];
        if (!selection.find((i) => i == item)) {
            selection.push(item);
        }

        if (item instanceof NamedSpecTreeItemData) {
            params.specNames = selection.flatMap((item) => {
                if (item instanceof NamedSpecTreeItemData) {
                    return [item.specMetadata.name];
                } else {
                    return [];
                }
            });
        } else if (item instanceof SpecVersionTreeItemData) {
            params.specVersions = selection.flatMap((item) => {
                if (item instanceof SpecVersionTreeItemData) {
                    return [item.specVersion];
                } else {
                    return [];
                }
            });
        } else if (item instanceof SpecResultTreeItemData || item instanceof SpecResultsTreeItemData) {
            params.specResultIds = [];
            for (item of selection) {
                if (item instanceof SpecResultTreeItemData) {
                    params.specResultIds.push(item.evalOutcome.spec_eval_results_id);
                } else if (item instanceof SpecResultsTreeItemData) {
                    const children = await item.children(this.apiClient, this.uiState);
                    for (const child of children) {
                        const childResult = child as SpecResultTreeItemData;
                        params.specResultIds.push(childResult.evalOutcome.spec_eval_results_id);
                    }
                }
            }
        }

        const reqOk =
            (params.specNames && params.specNames.length > 0) ||
            (params.specVersions && params.specVersions.length > 0) ||
            (params.specResultIds && params.specResultIds.length > 0);
        if (!reqOk) {
            throw new Error("Internal error: composed empty coverage request");
        }

        await this.cov.showSpecCoverage(params);
    }

    conformEval(args: specFileCommands.SpecEvalCommandArgs) {
        specFileCommands.runConformEvalCommand(args);
    }

    async showSpec(specNameOrVersion: string) {
        const speqtr = await specFileCommands.inspectSpecSpeqtr(specNameOrVersion);
        if (speqtr) {
            const doc = await vscode.workspace.openTextDocument({
                language: "speqtr",
                content: speqtr,
            });
            await vscode.window.showTextDocument(doc);
        }
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
    constructor(public specMetadata: api.SpecVersionMetadata, icon: vscode.ThemeIcon) {
        super(specMetadata.name);
        this.iconPath = icon;
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
        this.iconPath = new vscode.ThemeIcon("output");
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
    constructor(public key: string, public val: api.AttrVal) {
        super(`${key}: ${val}`);
        if (key == "spec.author") {
            this.iconPath = new vscode.ThemeIcon("person");
        } else {
            this.iconPath = new vscode.ThemeIcon("tag");
        }
    }
}

export class SpecVersionsTreeItemData extends SpecsTreeItemData {
    contextValue = "specVersions";
    constructor(public specName: string) {
        super("Versions");
        this.iconPath = new vscode.ThemeIcon("versions", new vscode.ThemeColor("symbolIcon.constructorForeground"));
    }

    override canHaveChildren(_workspaceData: SpecsTreeMemento): boolean {
        return true;
    }

    override async children(apiClient: api.Client, workspaceState: SpecsTreeMemento): Promise<SpecsTreeItemData[]> {
        const versions = await apiClient.spec(this.specName).versions();
        return await Promise.all(
            versions.map(async (versionMd) => {
                const showResults = workspaceState.getShowResults();
                let icon = undefined;
                if (!showResults) {
                    const stats = await getSpecVersionTopLevelStats(apiClient, versionMd.name, versionMd.version);
                    icon = getTopLevelStatsIcon(stats);
                } else {
                    icon = new vscode.ThemeIcon("file", new vscode.ThemeColor("symbolIcon.fileForeground"));
                }
                return new SpecVersionTreeItemData(versionMd.name, versionMd.version, versionMd.version_number, icon);
            })
        );
    }
}

export class SpecVersionTreeItemData extends SpecsTreeItemData {
    contextValue = "specVersion";
    constructor(
        public specName: api.SpecName,
        public specVersion: api.SpecVersionId,
        public specVersionNumber: number,
        icon: vscode.ThemeIcon
    ) {
        super("Spec Version: " + specVersionNumber);
        this.iconPath = icon;
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
        } else {
            return [];
        }
    }
}

export class SpecResultsTreeItemData extends SpecsTreeItemData {
    contextValue = "specResults";
    constructor(public specName: api.SpecName, public specVersion: api.SpecVersionId) {
        super("Results");
        this.iconPath = new vscode.ThemeIcon("graph");
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
        super("Spec Result");

        const d = new Date(0);
        d.setUTCSeconds(evalOutcome.spec_eval_at_utc_seconds);
        this.description = d.toString();

        if (evalOutcome.regions_failing > 0) {
            this.iconPath = new vscode.ThemeIcon("testing-failed-icon");
        } else {
            this.iconPath = new vscode.ThemeIcon("testing-passed-icon");
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
        this.iconPath = new vscode.ThemeIcon("pulse", new vscode.ThemeColor("symbolIcon.classForeground"));
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

        if (this.structure.cases != null) {
            for (const [name, type, attrs] of this.structure.cases) {
                removeNamesFromAttrMap(attrs);
                children.push(new CaseTreeItemData(name, type, attrs));
            }
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
        this.iconPath = new vscode.ThemeIcon("git-compare", new vscode.ThemeColor("symbolIcon.fieldForeground"));
    }
}

class UntilTreeItemData extends BehaviorItemTreeItemData {
    contextValue = "specBehaviorUntil";
    constructor(itemName: string, attributeMap: api.AttributeMap) {
        super("Until", itemName, attributeMap);
        this.iconPath = new vscode.ThemeIcon(
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
                this.iconPath = new vscode.ThemeIcon("bracket", new vscode.ThemeColor("symbolIcon.fieldForeground"));
                break;
            case "Recovery":
                this.iconPath = new vscode.ThemeIcon(
                    "bracket-dot",
                    new vscode.ThemeColor("symbolIcon.fieldForeground")
                );
                break;
            case "Prohibited":
                this.iconPath = new vscode.ThemeIcon(
                    "bracket-error",
                    new vscode.ThemeColor("symbolIcon.fieldForeground")
                );
                break;
        }
    }
}

function getNamedSpecIcon(summary?: api.SpecSegmentEvalOutcomeSummary): vscode.ThemeIcon {
    if (summary) {
        return getTopLevelStatsIcon({
            total_failing: summary.regions_failing,
            total_passing: summary.regions_passing,
            total_unknown: summary.regions_unknown,
            total_vacuous: summary.regions_vacuous,
        });
    } else {
        // Either we're showing results and/or versions, or no/multiple segments are selected
        return new vscode.ThemeIcon("file", new vscode.ThemeColor("symbolIcon.fileForeground"));
    }
}

async function getSpecVersionTopLevelStats(
    apiClient: api.Client,
    specName: string,
    specVersion: string
): Promise<TopLevelStats> {
    const results = await apiClient.spec(specName).version(specVersion).results();
    const total_failing = results.reduce((sum, result) => sum + result.regions_failing, 0);
    const total_passing = results.reduce((sum, result) => sum + result.regions_passing, 0);
    const total_unknown = results.reduce((sum, result) => sum + result.regions_unknown, 0);
    // TODO add vacuous
    //const total_vacuous = results.reduce((sum, result) => sum + result.regions_vacuous, 0);
    const total_vacuous = 0;
    return {
        total_failing,
        total_passing,
        total_unknown,
        total_vacuous,
    };
}

interface TopLevelStats {
    total_failing: number;
    total_passing: number;
    total_unknown: number;
    total_vacuous: number;
}

function getTopLevelStatsIcon(stats: TopLevelStats): vscode.ThemeIcon {
    if (stats.total_failing > 0) {
        return new vscode.ThemeIcon("testing-failed-icon", new vscode.ThemeColor("testing.iconFailed"));
    } else if (stats.total_unknown > 0) {
        return new vscode.ThemeIcon("unverified", new vscode.ThemeColor("testing.iconQueued"));
    } else if (stats.total_vacuous > 0) {
        return new vscode.ThemeIcon("question", new vscode.ThemeColor("testing.iconQueued"));
    } else if (stats.total_passing > 0) {
        return new vscode.ThemeIcon("verified-filled", new vscode.ThemeColor("testing.iconPassed"));
    } else {
        return new vscode.ThemeIcon("unverified", new vscode.ThemeColor("testing.iconQueued"));
    }
}
