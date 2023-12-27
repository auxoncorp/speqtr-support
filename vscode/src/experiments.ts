import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as mutators from "./mutators";
import * as modalityLog from "./modalityLog";

class ExperimentsTreeMemento {
    constructor(private readonly memento: vscode.Memento) {}

    // TODO - mutations/outcomes/etc
    // MutationsBySegment/Results
    // or
    // Flat list of mutations
    //
    // option for mutations-by-segment
    // or all-mutations-for-active-segment
    getShowUnavailable(): boolean {
        return this.memento.get("experimentsTree_showUnavailable", false);
    }

    async setShowUnavailable(val: boolean): Promise<void> {
        return this.memento.update("experimentsTree_showUnavailable", val);
    }
}

export class ExperimentsTreeDataProvider implements vscode.TreeDataProvider<ExperimentsTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<ExperimentsTreeItemData | ExperimentsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<ExperimentsTreeItemData | ExperimentsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;
    workspaceState?: ExperimentsTreeMemento;
    view: vscode.TreeView<ExperimentsTreeItemData>;

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
            vscode.commands.registerCommand("auxon.experiments.generateMutation", (itemData) =>
                this.generateMutationCommand(itemData)
            ),
            vscode.commands.registerCommand("auxon.experiments.viewLogFromMutation", (itemData) =>
                this.viewLogFromMutation(itemData)
            )
            //vscode.commands.registerCommand("auxon.experiments.showUnavailable", () => this.showUnavailable(true)),
            //vscode.commands.registerCommand("auxon.experiments.hideUnavailable", () => this.showUnavailable(false))
        );

        this.refresh();
    }

    refresh(): void {
        /*
        vscode.commands.executeCommand(
            "setContext",
            "auxon.experiments.unavailable",
            this.workspaceState.getShowUnavailable() ? "SHOW" : "HIDE"
        );
        */

        this._onDidChangeTreeData.fire(undefined);
    }

    showUnavailable(show: boolean) {
        this.workspaceState.setShowUnavailable(show);
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
                    return new NamedExperimentTreeItemData(experiment);
                })
            );
            const { compare } = Intl.Collator("en-US");
            return items.sort((a, b) => compare(a.name, b.name));
        } else {
            return await element.children(this.apiClient, this.workspaceState);
        }
    }

    generateMutationCommand(item: ExperimentsTreeItemData) {
        if (item instanceof NamedExperimentTreeItemData) {
            vscode.commands.executeCommand("auxon.deviant.createMutation", {
                experimentName: item.experiment.name,
            });
        }
    }

    viewLogFromMutation(item: ExperimentsTreeItemData) {
        if (item instanceof ExperimentMutationCoordinateTreeItemData) {
            // Encode the opaque_event_id as a string for the log command
            let eventIdStr = "";
            // TODO - our EventCoordinate utoipa::ToSchema impl serializes
            // this field as a 'opaque_event_id' property, but it
            // still is comming through as 'id'
            let opaque_event_id = [];
            if (Object.prototype.hasOwnProperty.call(item.coordinate, "id")) {
                opaque_event_id = item.coordinate["id"];
            } else if (Object.prototype.hasOwnProperty.call(item.coordinate, "opaque_event_id")) {
                opaque_event_id = item.coordinate["opaque_event_id"];
            }
            for (const octet of opaque_event_id) {
                if (octet != 0) {
                    eventIdStr += octet.toString(16).padStart(2, "0");
                }
            }
            const timelineIdStr = item.coordinate.timeline_id.replaceAll("-", "");
            vscode.commands.executeCommand(
                "auxon.modality.log",
                new modalityLog.ModalityLogCommandArgs({
                    from: `%${timelineIdStr}:${eventIdStr}`,
                })
            );
        }
    }
}

// This is the base of all the tree item data classes
abstract class ExperimentsTreeItemData {
    abstract contextValue: string;

    // TODO...
    mutatorId?: api.MutatorId = undefined;
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

        // Timeline selection updates the events summary view
        // Proposed mutation selects the mutator in the mutators tree view
        if (this.contextValue == "experimentMutation") {
            const command = {
                title: "Set the selected mutator",
                command: "auxon.mutators.setSelectedMutator",
                arguments: [this.mutatorId],
            };
            item.command = command;
        }

        return item;
    }

    // TODO - revise this interface
    canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return false;
    }

    // TODO - revise this interface
    async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        return [];
    }
}

export class NamedExperimentTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experiment";
    constructor(public experiment: api.Experiment) {
        super(experiment.name);
        super.iconPath = new vscode.ThemeIcon("beaker");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
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
        if (this.experiment.mutations.length > 0) {
            // TODO toggle this with show by-segment results
            const proposedMutations = [];
            for (const pm of this.experiment.mutations.filter(
                (pm) => pm[1].proposed_for_the_selected_experiment === true
            )) {
                const mutator = new mutators.Mutator(
                    this.experiment.mutators.find((m) => m.mutator_id == pm[0].mutator_id)
                );
                const mutation = pm[0];
                // NOTE: this is always WholeWorkspace
                const regionResults = this.experiment.regions[0][1];
                const mutChecklist = regionResults.find((mc) => mc[0] == mutation.mutation_id);
                let checklist = undefined;
                if (mutChecklist) {
                    checklist = mutChecklist[1];
                }
                proposedMutations.push(new ExperimentMutation(mutator, mutation, checklist));
            }
            children.push(new ExperimentMutationsTreeItemData(proposedMutations));

            // TODO toggle this with show by-segment results
            // ExperimentMutationsBySegmentsTreeItemData
            /*
           const proposedMutationsBySegment = new Map();
            for (const regionResults of this.experiment.regions) {
                const segName = regionResults[0];
                console.debug(segName);
            }
            */
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

export class ExperimentMutationsBySegmentsTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutationsBySegments";
    constructor(public proposedMutationsBySegment: Map<string, ExperimentMutation[]>) {
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
        for (const [segmentName, mutations] of this.proposedMutationsBySegment) {
            children.push(new ExperimentMutationsBySegmentTreeItemData(segmentName, mutations));
        }
        return children;
    }
}

export class ExperimentMutationsBySegmentTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutationsBySegment";
    constructor(public segmentName: string, public proposedMutations: ExperimentMutation[]) {
        super(segmentName);
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        for (const pm of this.proposedMutations) {
            children.push(new ExperimentMutationTreeItemData(pm));
        }
        return children;
    }
}

export class ExperimentMutationsTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutations";
    constructor(public proposedMutations: ExperimentMutation[]) {
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
        for (const pm of this.proposedMutations) {
            children.push(new ExperimentMutationTreeItemData(pm));
        }
        return children;
    }
}

export class ExperimentMutationTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutation";
    constructor(public proposedMutation: ExperimentMutation) {
        super(`${proposedMutation.mutator.name}`);
        super.iconPath = new vscode.ThemeIcon("zap");

        this.mutatorId = proposedMutation.mutator.id;

        this.description = proposedMutation.mutation.mutation_id;
        let tooltip = `- **Mutator Name**: ${proposedMutation.mutator.name}`;
        tooltip += `\n- **Mutator Id**: ${proposedMutation.mutator.id}`;
        tooltip += `\n- **Mutation Id**: ${proposedMutation.mutation.mutation_id}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        if (this.proposedMutation.checklist && this.proposedMutation.checklist.command_communicated_and_success) {
            const coord = this.proposedMutation.checklist.command_communicated_and_success[0];
            const timeline = await apiClient.timeline(coord.timeline_id).get();
            children.push(
                new ExperimentMutationCoordinateTreeItemData(
                    `Communicated Timeline: ${timeline.attributes["timeline.name"]}`,
                    coord
                )
            );
        }
        if (this.proposedMutation.checklist && this.proposedMutation.checklist.inject_attempted_and_success) {
            const coord = this.proposedMutation.checklist.inject_attempted_and_success[0];
            const timeline = await apiClient.timeline(coord.timeline_id).get();
            children.push(
                new ExperimentMutationCoordinateTreeItemData(
                    `Injected Timeline: ${timeline.attributes["timeline.name"]}`,
                    coord
                )
            );
        }
        // NOTE: keeping mutations under mutators tree view for now
        /*
        if (Object.keys(this.proposedMutation.mutation.params).length > 0) {
            children.push(new ExperimentMutationParametersTreeItemData(this.proposedMutation.mutation));
        }
        */
        return children;
    }
}

export class ExperimentMutationParametersTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutationParameters";
    constructor(public mutation: api.Mutation) {
        super("Parameters");
        super.iconPath = new vscode.ThemeIcon("output");
    }

    override canHaveChildren(_workspaceData: ExperimentsTreeMemento): boolean {
        return true;
    }

    override async children(
        _apiClient: api.Client,
        _workspaceState: ExperimentsTreeMemento
    ): Promise<ExperimentsTreeItemData[]> {
        const children = [];
        for (const [paramName, paramValue] of Object.entries(this.mutation.params)) {
            children.push(new ExperimentDetailLeafTreeItemData(`${paramName}: ${paramValue}`));
        }
        return children;
    }
}

export class ExperimentMutationCoordinateTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentMutationCoordinate";
    constructor(public name: string, public coordinate: api.EventCoordinate) {
        super(name);
        this.iconPath = new vscode.ThemeIcon("git-commit");
    }
}

export class ExperimentDetailLeafTreeItemData extends ExperimentsTreeItemData {
    contextValue = "experimentDetail";
    constructor(public label: string) {
        super(label);
    }
}

class ExperimentMutation {
    constructor(
        public mutator: mutators.Mutator,
        public mutation: api.Mutation,
        public checklist?: api.ExperimentMutationChecklist
    ) {}
}
