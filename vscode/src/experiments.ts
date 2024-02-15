import * as vscode from "vscode";
import * as api from "./modalityApi";

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
    workspaceState?: ExperimentsTreeMemento;
    view: vscode.TreeView<ExperimentsTreeItemData>;
    activeSegmentId?: api.WorkspaceSegmentId = undefined;

    constructor(private readonly apiClient: api.Client) {}

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
            vscode.commands.registerCommand("auxon.experiments.hideResults", () => this.showResults(false))
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

    setActiveSegmentIds(segmentIds?: api.WorkspaceSegmentId[]) {
        if (segmentIds && segmentIds.length == 1) {
            this.activeSegmentId = segmentIds[0];
        } else {
            this.activeSegmentId = undefined;
        }
        this.refresh();
    }

    getTreeItem(element: ExperimentsTreeItemData): vscode.TreeItem {
        return element.treeItem(this.workspaceState);
    }

    async getChildren(element?: ExperimentsTreeItemData): Promise<ExperimentsTreeItemData[]> {
        if (!element) {
            const experimentNames = await this.apiClient.experiments().list();
            const items = await Promise.all(
                experimentNames.map(async (name) => {
                    const experiment = await this.apiClient.experiment(name).get();
                    return new NamedExperimentTreeItemData(experiment, this.activeSegmentId);
                })
            );
            const { compare } = Intl.Collator("en-US");
            return items.sort((a, b) => compare(a.name, b.name));
        } else {
            return await element.children(this.apiClient, this.workspaceState);
        }
    }
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
        } else if (this.contextValue == "experimentSpec") {
            const command = {
                title: "Sets the selected spec in the specs tree view",
                command: "auxon.specs.revealSpec",
                arguments: [this.name],
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
    constructor(public experiment: api.Experiment, private activeSegmentId?: api.WorkspaceSegmentId) {
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
        if (workspaceState.getShowResults() && this.activeSegmentId) {
            const results = await apiClient.segment(this.activeSegmentId).experimentResults(this.experiment.name);
            children.push(new ExperimentResultsTreeItemData(new ExperimentResults(this.experiment.name, results)));
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
        children.push(new ExperimentDetailLeafTreeItemData(`Proposed Mutations: ${this.results.numProposedMutations}`));
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
    numProposedMutations: number;
    mutations: ExperimentMutation[];

    constructor(public experimentName: string, private results: api.ExperimentResults) {
        this.mutations = [];
        this.numProposedMutations = results.n_proposed_mutations;
        for (const mutationAndChecklist of results.mutations) {
            const mutation = mutationAndChecklist[0];
            const checklist = mutationAndChecklist[1];
            if (mutation.linked_experiment == experimentName && checklist.proposed_for_the_selected_experiment) {
                let mutatorName = "<unnamed>";
                const mutatorDef = results.mutators.find((m) => m.mutator_id == mutation.mutator_id);
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
