import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as cliConfig from "./cliConfig";
import * as config from "./config";
import * as tmp from "tmp-promise";
import {promises as fs} from "fs";
import { getNonce } from "./webviewUtil";
import { AssignNodeProps } from "./transitionGraph";

class ExperimentsTreeMemento {
    constructor(private readonly memento: vscode.Memento) {}

    getShowResults(): boolean {
        return this.memento.get("experimentsTree_showResults", false);
    }

    async setShowResults(val: boolean): Promise<void> {
        return this.memento.update("experimentsTree_showResults", val);
    }
}

export class ExperimentsTreeDataProvider implements vscode.TreeDataProvider<ExperimentsTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<ExperimentsTreeItemData | ExperimentsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<ExperimentsTreeItemData | ExperimentsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;
    workspaceState?: ExperimentsTreeMemento = undefined;
    view: vscode.TreeView<ExperimentsTreeItemData>;

    // Data scope related
    dataScope: ExperimentDataScope;

    constructor(private readonly apiClient: api.Client, private readonly extensionContext: vscode.ExtensionContext) {
        this.dataScope = new ExperimentDataScope(undefined, undefined, []);
    }

    register(context: vscode.ExtensionContext) {
        this.workspaceState = new ExperimentsTreeMemento(context.workspaceState);
        this.view = vscode.window.createTreeView("auxon.experiments", {
            treeDataProvider: this,
            canSelectMany: false,
        });

        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.experiments.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.experiments.showResults", () => this.showResults(true)),
            vscode.commands.registerCommand("auxon.experiments.hideResults", () => this.showResults(false)),
            vscode.commands.registerCommand("auxon.experiments.viewSpec", (itemData) => {
                if (itemData instanceof ExperimentSpecTreeItemData) {
                    vscode.commands.executeCommand("auxon.specs.revealSpec", itemData.name);
                }
            })
            vscode.commands.registerCommand("auxon.experiments.impact", (itemData) => this.impact(itemData)),
            vscode.commands.registerCommand("auxon.experiments.visualizeImpactScenario", (args) =>
                this.visualizeImpactScenario(args)
            ),
            vscode.tasks.onDidEndTaskProcess((ev) => this.onDidEndTaskProcess(ev))
        );

        this.refresh();
    }

    refresh(): void {
        vscode.commands.executeCommand(
            "setContext",
            "auxon.experiments.results",
            this.workspaceState.getShowResults() ? "SHOW" : "HIDE"
        );

        this._onDidChangeTreeData.fire(undefined);
    }

    showResults(show: boolean) {
        this.workspaceState.setShowResults(show);
        this.refresh();
    }

    setActiveWorkspace(workspaceVersionId: string) {
        this.dataScope.activeWorkspaceVersionId = workspaceVersionId;
        this.refresh();
    }

    setActiveSegmentIds(usedSegmentConfig?: cliConfig.ContextSegment, segmentIds?: api.WorkspaceSegmentId[]) {
        if (usedSegmentConfig) {
            this.dataScope.usedSegmentConfig = usedSegmentConfig;
        }
        if (segmentIds) {
            this.dataScope.activeSegments = segmentIds;
        }
        this.refresh();
    }

    getTreeItem(element: ExperimentsTreeItemData): vscode.TreeItem {
        return element.treeItem(this.workspaceState);
    }

    async impact(itemData: ExperimentsTreeItemData) {
        if (itemData instanceof NamedExperimentTreeItemData) {
            const deviantPath = config.toolPath("deviant");
            const tempFile = await tmp.file({ mode: 0o600, prefix: "deviant-experiment-impact-", postfix: ".html" });
            const commandArgs = [
                "experiment",
                "impact",
                itemData.experiment.name,
                "-f",
                "html",
                ...config.extraCliArgs("deviant experiment impact"),
                "-o",
                tempFile.path,
            ];

            const taskDef: vscode.TaskDefinition = {
                type: "auxon.deviant.experiment.impact",
                command: deviantPath,
                args: commandArgs,
            };
            const problemMatchers = [];
            const exec = new vscode.ProcessExecution(taskDef.command, taskDef.args);
            const task = new vscode.Task(
                taskDef,
                vscode.TaskScope.Workspace,
                "deviant experiment impact",
                "deviant",
                exec,
                problemMatchers
            );

            task.group = vscode.TaskGroup.Build;
            task.presentationOptions = {
                echo: true,
                reveal: vscode.TaskRevealKind.Always,
                panel: vscode.TaskPanelKind.Dedicated,
                clear: true,
            };

            return await vscode.tasks.executeTask(task);
        }
    }

    async onDidEndTaskProcess(ev: vscode.TaskProcessEndEvent) {
        if (ev.execution.task.definition.type == "auxon.deviant.experiment.impact") {
            const execution = ev.execution.task.execution as vscode.ProcessExecution;
            const experimentName = execution.args[2];
            const outFile = execution.args.at(-1);

            const webViewPanel = vscode.window.createWebviewPanel(
                "auxon.experimentImpactReport",
                `Experiment Impact: "${experimentName}"`,
                vscode.ViewColumn.One,
                {
                    enableFindWidget: true,
                    retainContextWhenHidden: true,
                    enableScripts: true,
                    enableCommandUris: true,
                }
            );

            const scriptUri = webViewPanel.webview.asWebviewUri(
                vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "experimentImpact.js")
            );

            const nonce = getNonce();
            const cspSource = webViewPanel.webview.cspSource;
            const csp =
                "default-src 'none'; " +
                `font-src ${cspSource}; ` +
                `style-src ${cspSource} 'unsafe-inline'; ` +
                `img-src 'self' data:; script-src 'nonce-${nonce}';`;

            let htmlContent = await fs.readFile(outFile, "utf8");
            htmlContent = htmlContent.replace(
                "<!-- VSCODE HEADER INJECTION POINT -->",
                `<meta http-equiv="Content-Security-Policy" content="${csp}"/>`
            );

            htmlContent = htmlContent.replace(
                "<!-- VSCODE SCRIPT INJECTION POINT -->",
                `<script nonce="${nonce}" type="text/javascript" src="${scriptUri}"></script>`
            );

            webViewPanel.webview.html = htmlContent;
            webViewPanel.webview.onDidReceiveMessage((msg) => {
                switch (msg.command) {
                    case "visualizeImpactScenario":
                        this.visualizeImpactScenario(msg.args);
                        break;
                    default:
                        throw `Received sunsupported command from webview: ${msg.command}`;
                }
            });
        }
    }

    visualizeImpactScenario(scenario: ImpactScenario) {
        const segmentIds = scenario.mutations.map((m) => m.segmentId);

        const assignNodeProps = new AssignNodeProps();
        for (const mutation of scenario.mutations) {
            assignNodeProps.addClass(mutation.timelineName, "mutation");
        }

        for (const impact of scenario.impactedTimelines) {
            assignNodeProps.addClass(impact.timelineName, "impact");
            assignNodeProps.addDataProp(impact.timelineName, "severity", impact.severity);
            assignNodeProps.addDataProp(impact.timelineName, "impactHtml", impact.detailsHtml);
        }

        vscode.commands.executeCommand("auxon.transition.graph", {
            type: "segment",
            segmentIds,
            title: `Experiment Impact for scenario '${scenario.scenarioName}'`,
            //title: `Experiment Impact for '${scenario.experimentName}' scenario '${scenario.scenarioName}'`,
            groupBy: ["timeline.name"],
            assignNodeProps,
        });
    }

    async getChildren(element?: ExperimentsTreeItemData): Promise<ExperimentsTreeItemData[]> {
        if (!element) {
            const experimentNames = await this.apiClient.experiments().list();
            const items = await Promise.all(
                experimentNames.map(async (name) => {
                    const experiment = await this.apiClient.experiment(name).get();
                    return new NamedExperimentTreeItemData(experiment, this.dataScope);
                })
            );
            const { compare } = Intl.Collator("en-US");
            return items.sort((a, b) => compare(a.name, b.name));
        } else {
            return await element.children(this.apiClient, this.workspaceState);
        }
    }
}

interface ImpactScenario {
    scenarioName: string;
    mutations: [
        {
            mutationId: string;
            timelineId: string;
            timelineName: string;
            segmentId: api.WorkspaceSegmentId;
        }
    ];
    impactedTimelines: [
        {
            timelineName: string;
            events: [string];
            severity: number;
            detailsHtml: string;
        }
    ];
}

abstract class ExperimentsTreeItemData {
    abstract contextValue: string;

    mutationId?: api.MutationId;
    createdAt?: Date;
    description?: string = undefined;
    tooltip?: vscode.MarkdownString = undefined;
    iconPath?: vscode.ThemeIcon = undefined;

    constructor(public name: string) {}

    treeItem(workspaceData: ExperimentsTreeMemento): vscode.TreeItem {
        let state = vscode.TreeItemCollapsibleState.Collapsed;
        if (!this.canHaveChildren(workspaceData)) {
            state = vscode.TreeItemCollapsibleState.None;
        }

        const item = new vscode.TreeItem(this.name, state);
        item.contextValue = this.contextValue;
        item.description = this.description;
        item.tooltip = this.tooltip;
        item.iconPath = this.iconPath;

        // Mutation selection sets the selected mutation
        if (this.contextValue == "experimentMutation" && workspaceData.getShowResults()) {
            const command = {
                title: "Reveal a mutation in the mutations tree view",
                command: "auxon.mutations.revealMutation",
                arguments: [this.mutationId],
            };
            item.command = command;
        }

        return item;
    }

    canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return false;
    }

    async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        return [];
    }
}

export class NamedExperimentTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experiment";
    constructor(public experiment: api.Experiment, private dataScope: ExperimentDataScope) {
        super(experiment.name);
        super.iconPath = new vscode.ThemeIcon("beaker");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        apiClient: api.Client,
        workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        const item = new ExperimentDetailLeafTreeItemData(`Approach: ${this.experiment.definition.approach}`);
        item.iconPath = new vscode.ThemeIcon("find-selection");
        children.push(item);

        if (this.experiment.definition.mutator_filter) {
            const item = new ExperimentDetailLeafTreeItemData(
                `Mutator Filter: ${this.experiment.definition.mutator_filter}`
            );
            item.iconPath = new vscode.ThemeIcon("filter");
            children.push(item);
        }
        if (this.experiment.definition.mutator_constraints) {
            const constraints = new Map();
            for (const [mutName, mutConstraint] of Object.entries(this.experiment.definition.mutator_constraints)) {
                constraints.set(mutName, mutConstraint);
            }
            if (constraints.size != 0) {
                children.push(new ExperimentMutatorConstraintsTreeItemData(constraints));
            }
        }
        if (this.experiment.definition.expected_mutators.length != 0) {
            children.push(new ExperimentExpectedMutatorsTreeItemData(this.experiment.definition.expected_mutators));
        }
        if (this.experiment.definition.specs.length != 0) {
            children.push(new ExperimentSpecsTreeItemData(this.experiment.definition.specs));
        }
        if (workspaceState.getShowResults()) {
            let results = undefined;
            switch (this.dataScope.usedSegmentConfig.type) {
                case "All":
                case "WholeWorkspace":
                    if (this.dataScope.activeWorkspaceVersionId) {
                        results = await apiClient
                            .workspace(this.dataScope.activeWorkspaceVersionId)
                            .experimentResults(this.experiment.name);
                    }
                    break;
                case "Latest":
                case "Set":
                    if (this.dataScope.activeSegments.length != 0) {
                        results = await apiClient
                            .segment(this.dataScope.activeSegments[0])
                            .experimentResults(this.experiment.name);

                        // Merge results of remaining segments, ExperimentResults will sort them out
                        for (let i = 1; i < this.dataScope.activeSegments.length; i++) {
                            const segRes = await apiClient
                                .segment(this.dataScope.activeSegments[i])
                                .experimentResults(this.experiment.name);
                            results.mutations.push(...segRes.mutations);
                            results.mutators.push(...segRes.mutators);
                            results.regions.push(...segRes.regions);
                        }
                    }
                    break;
            }

            if (results) {
                children.push(new ExperimentResultsTreeItemData(new ExperimentResults(this.experiment.name, results)));
            }
        }
        return children;
    }
}

export class ExperimentMutatorConstraintsTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutatorConstraints";
    constructor(public constraints: Map<string, api.MutatorUseConstraint>) {
        super("Mutator Constraints");
        super.iconPath = new vscode.ThemeIcon("ungroup-by-ref-type");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        for (const [mutName, mutConstraint] of this.constraints) {
            children.push(new ExperimentMutatorConstraintTreeItemData(mutName, mutConstraint));
        }
        return children;
    }
}

export class ExperimentMutatorConstraintTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutatorConstraint";
    constructor(public constraintName: string, public constraint: api.MutatorUseConstraint) {
        super(constraintName);
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        const item = new ExperimentDetailLeafTreeItemData(`Mutator Selector: ${this.constraint.mutator_selector}`);
        item.iconPath = new vscode.ThemeIcon("search-fuzzy");
        children.push(item);
        if (this.constraint.param_constraints) {
            const constraints = new Map();
            for (const [paramName, paramConstraint] of Object.entries(this.constraint.param_constraints)) {
                constraints.set(paramName, paramConstraint);
            }
            if (constraints.size != 0) {
                children.push(new ExperimentParameterConstraintsTreeItemData(constraints));
            }
        }
        return children;
    }
}

export class ExperimentParameterConstraintsTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentParameterConstraints";
    constructor(public constraints: Map<string, api.ParamConstraint>) {
        super("Parameter Constraints");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        for (const [paramName, paramConstraint] of this.constraints) {
            children.push(new ExperimentParameterConstraintTreeItemData(paramName, paramConstraint));
        }
        return children;
    }
}

export class ExperimentParameterConstraintTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentParameterConstraint";
    constructor(public paramName: string, public constraint: api.ParamConstraint) {
        super(paramName);
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        if (
            this.constraint.inclusive_value_min != undefined ||
            this.constraint.inclusive_value_max != undefined ||
            this.constraint.exact_value_set != undefined
        ) {
            return true;
        } else {
            return false;
        }
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        if (this.constraint.inclusive_value_min != undefined) {
            children.push(new ExperimentDetailLeafTreeItemData(`Min: ${this.constraint.inclusive_value_min}`));
        }
        if (this.constraint.inclusive_value_max != undefined) {
            children.push(new ExperimentDetailLeafTreeItemData(`Max: ${this.constraint.inclusive_value_max}`));
        }
        if (this.constraint.exact_value_set != undefined) {
            const joined = this.constraint.exact_value_set.join(", ");
            children.push(new ExperimentDetailLeafTreeItemData(`Exact Value Set: ${joined}`));
        }
        return children;
    }
}

export class ExperimentExpectedMutatorsTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentExpectedMutators";
    constructor(public expectedMutators: api.UnstructuredMutatorFilter[]) {
        super("Expected Mutators");
        super.iconPath = new vscode.ThemeIcon("outline-view-icon");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        for (const mutatorFilter of this.expectedMutators) {
            const item = new ExperimentDetailLeafTreeItemData(mutatorFilter);
            item.iconPath = new vscode.ThemeIcon("filter");
            children.push(item);
        }
        return children;
    }
}

export class ExperimentSpecsTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentSpecs";
    constructor(public specs: api.ExperimentLinkedSpec[]) {
        super("Specs");
        super.iconPath = new vscode.ThemeIcon("explorer-view-icon");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        for (const spec of this.specs) {
            children.push(new ExperimentSpecTreeItemData(spec));
        }
        return children;
    }
}

export class ExperimentSpecTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentSpec";
    constructor(public spec: api.ExperimentLinkedSpec) {
        super(spec.name);
        let tooltip = `- **Spec Name**: ${spec.name}`;
        tooltip += `\n- **Spec Version**: ${spec.version}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
        this.description = spec.version;
        this.iconPath = new vscode.ThemeIcon("file");
    }
}

export class ExperimentResultsTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentResults";
    constructor(public results: ExperimentResults) {
        super("Results");
        super.iconPath = new vscode.ThemeIcon("graph");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        children.push(
            new ExperimentDetailLeafTreeItemData(`Overall Proposed Mutations: ${this.results.numProposedMutations}`)
        );
        children.push(
            new ExperimentDetailLeafTreeItemData(
                `Proposed Mutations For Selected Data Scope: ${this.results.mutations.length}`
            )
        );
        if (this.results.mutations.length != 0) {
            children.push(new ExperimentMutationsTreeItemData(this.results.mutations));
        }
        return children;
    }
}

export class ExperimentMutationsTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutations";
    constructor(public mutations: ExperimentMutation[]) {
        super("Mutations");
        super.iconPath = new vscode.ThemeIcon("replace-all");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        for (const mutation of this.mutations) {
            children.push(new ExperimentMutationTreeItemData(mutation));
        }
        children.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return children;
    }
}

export class ExperimentMutationTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutation";
    constructor(public mutation: ExperimentMutation) {
        super(mutation.mutatorName);
        let tooltip = `- **Mutator Name**: ${mutation.mutatorName}`;
        tooltip += `\n- **Mutator Id**: ${mutation.mutatorId}`;
        tooltip += `\n- **Mutation Id**: ${mutation.mutationId}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
        this.description = mutation.mutationId;
        this.iconPath = new vscode.ThemeIcon("zap");
        this.createdAt = mutation.createdAt;
        this.mutationId = mutation.mutationId;
    }
}

export class ExperimentDetailLeafTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentDetail";
    constructor(public label: string) {
        super(label);
    }
}

class ExperimentResults {
    // Total proposed mutations for the lifespan of this experiment
    numProposedMutations: number;
    // Mutations relevant to the selected data scope
    mutations: ExperimentMutation[];

    constructor(public experimentName: string, private results: api.ExperimentResults) {
        const mutationIdsToChecklist: Map<api.MutationId, api.ExperimentMutationChecklist> = new Map();
        for (const regionAndmutationAndChecklist of results.regions) {
            const mutationsAndChecklists = regionAndmutationAndChecklist[1];
            for (const mutationAndChecklist of mutationsAndChecklists) {
                const mutationId = mutationAndChecklist[0];
                const checklist = mutationAndChecklist[1];
                mutationIdsToChecklist.set(mutationId, checklist);
            }
        }

        const mutations: Map<api.MutationId, api.Mutation> = new Map();
        for (const mutationAndChecklist of results.mutations) {
            const mutation = mutationAndChecklist[0];
            const _overall_checklist = mutationAndChecklist[1]; // using the per-region-checklist
            mutations.set(mutation.mutation_id, mutation);
        }

        const mutators = [...new Set(results.mutators)];

        this.mutations = [];
        this.numProposedMutations = results.n_proposed_mutations;
        for (const [_mutationId, mutation] of mutations) {
            if (mutationIdsToChecklist.has(mutation.mutation_id)) {
                const checklist = mutationIdsToChecklist.get(mutation.mutation_id);
                if (mutation.linked_experiment == experimentName && checklist.proposed_for_the_selected_experiment) {
                    let mutatorName = "<unnamed>";
                    const mutatorDef = mutators.find((m) => m.mutator_id == mutation.mutator_id);
                    if (mutatorDef) {
                        if (Object.prototype.hasOwnProperty.call(mutatorDef.mutator_attributes, "mutator.name")) {
                            mutatorName = mutatorDef.mutator_attributes["mutator.name"] as string;
                        }
                    }
                    this.mutations.push(new ExperimentMutation(mutation, mutatorName));
                }
            }
        }
    }
}

class ExperimentMutation {
    mutationId: api.MutationId;
    mutatorId: api.MutatorId;
    createdAt: Date;

    constructor(public mutation: api.Mutation, public mutatorName: string) {
        this.mutationId = mutation.mutation_id;
        this.mutatorId = mutation.mutator_id;
        this.createdAt = new Date(0);
        this.createdAt.setUTCSeconds(mutation.created_at_utc_seconds);
    }
}

class ExperimentDataScope {
    constructor(
        public usedSegmentConfig?: cliConfig.ContextSegment,
        public activeWorkspaceVersionId?: string,
        public activeSegments?: api.WorkspaceSegmentId[]
    ) {}
}
