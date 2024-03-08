import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as modalityLog from "./modalityLog";
import * as workspaceState from "./workspaceState";

class MutationsTreeMemento {
    constructor(private readonly memento: vscode.Memento) {}

    getGroupByMutatorName(): boolean {
        return this.memento.get("mutationsTree_groupByMutatorName", false);
    }

    async setGroupByMutatorName(val: boolean): Promise<void> {
        return this.memento.update("mutationsTree_groupByMutatorName", val);
    }

    getFilterBySelectedMutator(): boolean {
        return this.memento.get("mutationsTree_filterBySelectedMutator", false);
    }

    async setFilterBySelectedMutator(val: boolean): Promise<void> {
        return this.memento.update("mutationsTree_filterBySelectedMutator", val);
    }

    getShowClearedMutations(): boolean {
        return this.memento.get("mutationsTree_showClearedMutations", false);
    }

    async setShowClearedMutations(val: boolean): Promise<void> {
        return this.memento.update("mutationsTree_showClearedMutations", val);
    }
}

export class MutationsTreeDataProvider implements vscode.TreeDataProvider<MutationsTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<MutationsTreeItemData | MutationsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<MutationsTreeItemData | MutationsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    uiState: MutationsTreeMemento;
    data: MutationsTreeItemData[] = [];
    view: vscode.TreeView<MutationsTreeItemData>;
    selectedMutatorId?: api.MutatorId = undefined;

    constructor(
        private readonly apiClient: api.Client,
        private wss: workspaceState.WorkspaceAndSegmentState,
        context: vscode.ExtensionContext
    ) {
        this.uiState = new MutationsTreeMemento(context.workspaceState);
        this.view = vscode.window.createTreeView("auxon.mutations", {
            treeDataProvider: this,
            canSelectMany: false,
        });

        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.mutations.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.mutations.setSelectedMutator", (mutatorId) => {
                this.setSelectedMutator(mutatorId);
            }),
            vscode.commands.registerCommand("auxon.mutations.revealMutation", (mutationId) => {
                this.revealMutation(mutationId);
            }),
            vscode.commands.registerCommand("auxon.mutations.disableMutationGrouping", () => {
                this.disableMutationGrouping();
            }),
            vscode.commands.registerCommand("auxon.mutations.groupMutationsByName", () => {
                this.groupMutationsByName();
            }),
            vscode.commands.registerCommand("auxon.mutations.disableMutationFiltering", () => {
                this.disableMutationFiltering();
            }),
            vscode.commands.registerCommand("auxon.mutations.filterBySelectedMutator", () => {
                this.filterBySelectedMutator();
            }),
            vscode.commands.registerCommand("auxon.mutations.showCleared", () => this.showClearedMutations(true)),
            vscode.commands.registerCommand("auxon.mutations.hideCleared", () => this.showClearedMutations(false)),
            vscode.commands.registerCommand("auxon.mutations.clearMutation", (itemData) => {
                this.clearMutation(itemData);
            }),
            vscode.commands.registerCommand("auxon.mutations.viewLogFromMutation", (itemData) =>
                this.viewLogFromMutation(itemData)
            ),
            this.wss.onDidChangeUsedSegments(() => this.refresh())
        );

        this.refresh();
    }

    refresh(): void {
        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutations.groupBy",
            this.uiState.getGroupByMutatorName() ? "MUTATOR_NAME" : "NONE"
        );
        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutations.filterBy",
            this.uiState.getFilterBySelectedMutator() ? "MUTATOR_ID" : "NONE"
        );
        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutations.cleared",
            this.uiState.getShowClearedMutations() ? "SHOW" : "HIDE"
        );

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: MutationsTreeItemData): vscode.TreeItem {
        return element.treeItem(this.uiState);
    }

    async getChildren(element?: MutationsTreeItemData): Promise<MutationsTreeItemData[]> {
        if (this.uiState.getFilterBySelectedMutator() && this.selectedMutatorId == null) {
            // Need a selected mutator to populate with
            return [];
        } else if (!element) {
            let mutations = [];
            this.data = [];

            switch (this.wss.activeSegments.type) {
                case "WholeWorkspace":
                    mutations = await this.apiClient
                        .workspace(this.wss.activeWorkspaceVersionId)
                        .mutations(this.selectedMutatorId);
                    break;
                case "Explicit":
                    if (this.wss.activeSegments.isAllSegments) {
                        mutations = await this.apiClient.mutations().list(this.selectedMutatorId);
                    } else {
                        for (const segmentId of this.wss.activeSegments.segmentIds) {
                            const segMutations = await this.apiClient
                                .segment(segmentId)
                                .mutations(this.selectedMutatorId);
                            mutations.push(...segMutations);
                        }
                    }
                    break;
            }

            mutations = mutations.map((m) => new Mutation(m));
            if (!this.uiState.getShowClearedMutations()) {
                mutations = mutations.filter((m) => !m.wasCleared());
            }

            if (this.uiState.getGroupByMutatorName()) {
                const root = new MutationsGroupByNameTreeItemData("", []);
                for (const m of mutations) {
                    root.insertNode(m);
                }
                root.updateDescriptions();
                root.sortMutationsByCreatedAt();
                const { compare } = Intl.Collator("en-US");
                this.data = await root.children(this.apiClient);
                this.data.sort((a, b) => compare(a.name, b.name));
            } else {
                this.data = mutations.map((m) => new NamedMutationTreeItemData(m));
                this.data.sort((a, b) => {
                    if (!(a instanceof NamedMutationTreeItemData) || !(b instanceof NamedMutationTreeItemData)) {
                        throw new Error("Internal error: mutations tree node not of expected type");
                    }
                    // Most recent first
                    return b.mutation.createdAt.getTime() - a.mutation.createdAt.getTime();
                });
            }
            return this.data;
        } else {
            return await element.children(this.apiClient);
        }
    }

    getParent(element: MutationsTreeItemData): vscode.ProviderResult<MutationsTreeItemData> {
        if (this.uiState.getGroupByMutatorName()) {
            for (const group of this.data) {
                if (!(group instanceof MutationsGroupByNameTreeItemData)) {
                    throw new Error("Internal error: mutations tree node not of expected type");
                }
                if (group.childItems.includes(element)) {
                    return group;
                }
            }
        }
        return undefined;
    }

    // Set the selected mutator when grouping by mutator name or only showing a single mutator
    setSelectedMutator(mutatorId: api.MutatorId) {
        if (this.uiState.getFilterBySelectedMutator()) {
            if (this.selectedMutatorId != mutatorId) {
                this.selectedMutatorId = mutatorId;
                this.refresh();
            }
        } else if (this.uiState.getGroupByMutatorName() && this.selectedMutatorId != mutatorId) {
            this.selectedMutatorId = mutatorId;

            for (const group of this.data) {
                if (!(group instanceof MutationsGroupByNameTreeItemData)) {
                    throw new Error("Internal error: mutations tree node not of expected type");
                }
                const item = group.childItems.find((i) => i.mutatorId == mutatorId);
                if (item) {
                    // Just reveal the parent group
                    this.view.reveal(group, { focus: true, select: true, expand: 1 });
                    return;
                }
            }
        }
    }

    revealMutation(mutationId: api.MutationId) {
        if (this.uiState.getGroupByMutatorName()) {
            for (const group of this.data) {
                if (!(group instanceof MutationsGroupByNameTreeItemData)) {
                    throw new Error("Internal error: mutations tree node not of expected type");
                }
                const item = group.childItems.find((i) => i.mutationId == mutationId);
                if (item) {
                    // Treeview doesn't appear to handle selecting nested items well.
                    // Instead we need to reveal the parent first then the item
                    this.view.reveal(group, { focus: true, select: true, expand: 1 }).then(() => {
                        this.view.reveal(item, { focus: true, select: true, expand: 10 });
                    });
                    return;
                }
            }
        } else {
            const item = this.data.find((i) => i.mutationId == mutationId);
            if (item) {
                this.view.reveal(item, { focus: true, select: true, expand: 10 });
            }
        }
    }

    disableMutationGrouping() {
        this.uiState.setGroupByMutatorName(false);
        this.clearSelectedMutator();
        this.refresh();
    }

    groupMutationsByName() {
        this.uiState.setGroupByMutatorName(true);
        this.clearSelectedMutator();
        this.refresh();
    }

    disableMutationFiltering() {
        this.uiState.setFilterBySelectedMutator(false);
        this.clearSelectedMutator();
        this.refresh();
    }

    filterBySelectedMutator() {
        this.uiState.setFilterBySelectedMutator(true);
        this.clearSelectedMutator();
        this.refresh();
    }

    showClearedMutations(show: boolean) {
        this.uiState.setShowClearedMutations(show);
        this.refresh();
    }

    clearSelectedMutator() {
        this.selectedMutatorId = undefined;
    }

    clearMutation(item: MutationsTreeItemData) {
        if (!(item instanceof NamedMutationTreeItemData)) {
            throw new Error("Internal error: mutations tree node not of expected type");
        }
        vscode.commands.executeCommand("auxon.deviant.clearMutation", { mutationId: item.mutationId });
    }

    viewLogFromMutation(item: MutationsTreeItemData) {
        if (item instanceof MutationCoordinateTreeItemData) {
            if (item.coordinate.id == null || item.coordinate.timeline_id == null) {
                throw new Error("Malformed event coordinate");
            }

            // Encode the opaque_event_id as a string for the log command
            let eventIdStr = "";
            const opaque_event_id = item.coordinate.id;
            for (const octet of opaque_event_id) {
                if (octet != 0) {
                    eventIdStr += octet.toString(16).padStart(2, "0");
                }
            }

            const literalTimelineId = "%" + item.coordinate.timeline_id.replace(/-/g, "");

            vscode.commands.executeCommand(
                "auxon.modality.log",
                new modalityLog.ModalityLogCommandArgs({
                    from: `${literalTimelineId}:${eventIdStr}`,
                })
            );
        }
    }
}

// This is the base of all the tree item data classes
abstract class MutationsTreeItemData {
    abstract contextValue: string;

    id?: string = undefined;
    mutatorId?: api.MutatorId = undefined;
    mutationId?: api.MutationId = undefined;
    description?: string = undefined;
    tooltip?: vscode.MarkdownString = undefined;
    iconPath?: vscode.ThemeIcon = undefined;

    constructor(public name: string) {}

    treeItem(workspaceData: MutationsTreeMemento): vscode.TreeItem {
        let state = vscode.TreeItemCollapsibleState.Collapsed;
        if (!this.canHaveChildren()) {
            state = vscode.TreeItemCollapsibleState.None;
        }

        const item = new vscode.TreeItem(this.name, state);
        item.contextValue = this.contextValue;
        item.description = this.description;
        item.tooltip = this.tooltip;
        item.iconPath = this.iconPath;

        // Mutation selection sets the selected mutator
        if (this.contextValue == "mutation" && !workspaceData.getFilterBySelectedMutator()) {
            const command = {
                title: "Reveal a mutator in the mutators tree view",
                command: "auxon.mutators.revealMutator",
                arguments: [this.mutatorId],
            };
            item.command = command;
        }

        return item;
    }

    canHaveChildren(): boolean {
        return false;
    }

    async children(_apiClient: api.Client): Promise<MutationsTreeItemData[]> {
        return [];
    }
}

export class MutationsGroupByNameTreeItemData extends MutationsTreeItemData {
    contextValue = "mutationsGroup";
    constructor(public name: string, public childItems: MutationsTreeItemData[]) {
        super(name);
        this.iconPath = new vscode.ThemeIcon("replace-all");
        const tooltip = `- **Mutator Name**: ${name}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override async children(_apiClient: api.Client): Promise<MutationsTreeItemData[]> {
        return this.childItems;
    }

    insertNode(mutation: Mutation) {
        let nextNodeIndex = this.childItems.findIndex((item) => item.name == mutation.mutatorName);
        if (nextNodeIndex == -1) {
            this.childItems.push(new MutationsGroupByNameTreeItemData(mutation.mutatorName, []));
            nextNodeIndex = this.childItems.length - 1;
        }

        const nextNode = this.childItems[nextNodeIndex];
        if (!(nextNode instanceof MutationsGroupByNameTreeItemData)) {
            throw new Error("Internal error: mutations tree node not of expected type");
        }
        nextNode.childItems.push(new NamedMutationTreeItemData(mutation));
    }

    updateDescriptions() {
        for (const group of this.childItems) {
            if (group instanceof MutationsGroupByNameTreeItemData && group.childItems.length > 0) {
                const mutationCount = group.childItems.length;
                const mutatorIds = new Set();
                for (const item of group.childItems) {
                    mutatorIds.add(item.mutatorId);
                }
                group.description = `${mutationCount} mutation`;
                if (mutationCount > 1) {
                    group.description += "s";
                }
                group.description += `, ${mutatorIds.size} mutator`;
                if (mutatorIds.size > 1) {
                    group.description += "s";
                }
            }
        }
    }

    sortMutationsByCreatedAt() {
        for (const group of this.childItems) {
            if (group instanceof MutationsGroupByNameTreeItemData && group.childItems.length > 0) {
                group.childItems.sort((a, b) => {
                    if (!(a instanceof NamedMutationTreeItemData) || !(b instanceof NamedMutationTreeItemData)) {
                        throw new Error("Internal error: mutations tree node not of expected type");
                    }
                    // Most recent first
                    return b.mutation.createdAt.getTime() - a.mutation.createdAt.getTime();
                });
            }
        }
    }
}

export class NamedMutationTreeItemData extends MutationsTreeItemData {
    contextValue = "mutation";
    constructor(public mutation: Mutation) {
        super(mutation.mutatorName);
        this.id = `${mutation.mutationId}`;
        this.mutatorId = mutation.mutatorId;
        this.mutationId = mutation.mutationId;
        this.description = mutation.mutationId;
        let tooltip = `- **Mutator Name**: ${mutation.mutatorName}`;
        tooltip += `\n- **Mutator Id**: ${mutation.mutatorId}`;
        tooltip += `\n- **Mutation Id**: ${mutation.mutationId}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
        this.iconPath = new vscode.ThemeIcon("zap");
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override async children(apiClient: api.Client): Promise<MutationsTreeItemData[]> {
        const children = [];
        children.push(new MutationDetailLeafTreeItemData(`Created At: ${this.mutation.createdAt}`));
        if (this.mutation.experimentName) {
            children.push(new MutationDetailLeafTreeItemData(`Experiment: ${this.mutation.experimentName}`));
        }

        if (this.mutation.regionDetailsSummary && this.mutation.regionDetailsSummary.command_communicated_and_success) {
            const coord = this.mutation.regionDetailsSummary.command_communicated_and_success[0];
            const maybeSuccess = this.mutation.regionDetailsSummary.command_communicated_and_success[1];

            if (coord.timeline_id == null) {
                throw new Error("Malformed timeline id");
            }
            const timeline = await apiClient.timeline(coord.timeline_id).get();

            let timelineStr = `${coord.timeline_id}`;
            if (Object.prototype.hasOwnProperty.call(timeline.attributes, "timeline.name")) {
                timelineStr = timeline.attributes["timeline.name"] as string;
            }
            children.push(
                new MutationCoordinateTreeItemData(`Communicated Timeline: ${timelineStr}`, coord, maybeSuccess)
            );
        }

        if (this.mutation.regionDetailsSummary && this.mutation.regionDetailsSummary.inject_attempted_and_success) {
            const coord = this.mutation.regionDetailsSummary.inject_attempted_and_success[0];
            const maybeSuccess = this.mutation.regionDetailsSummary.inject_attempted_and_success[1];

            if (coord.timeline_id == null) {
                throw new Error("Malformed timeline id");
            }
            const timeline = await apiClient.timeline(coord.timeline_id).get();

            let timelineStr = `${coord.timeline_id}`;
            if (Object.prototype.hasOwnProperty.call(timeline.attributes, "timeline.name")) {
                timelineStr = timeline.attributes["timeline.name"] as string;
            }
            children.push(new MutationCoordinateTreeItemData(`Injected Timeline: ${timelineStr}`, coord, maybeSuccess));
        }

        if (this.mutation.regionDetailsSummary && this.mutation.regionDetailsSummary.clear_communicated_and_success) {
            const coord = this.mutation.regionDetailsSummary.clear_communicated_and_success[0];
            const maybeSuccess = this.mutation.regionDetailsSummary.clear_communicated_and_success[1];

            if (coord.timeline_id == null) {
                throw new Error("Malformed timeline id");
            }
            const timeline = await apiClient.timeline(coord.timeline_id).get();

            let timelineStr = `${coord.timeline_id}`;
            if (Object.prototype.hasOwnProperty.call(timeline.attributes, "timeline.name")) {
                timelineStr = timeline.attributes["timeline.name"] as string;
            }
            children.push(new MutationCoordinateTreeItemData(`Cleared Timeline: ${timelineStr}`, coord, maybeSuccess));
        }

        if (this.mutation.params.size != 0) {
            children.push(new MutationParametersTreeItemData(this.mutation));
        }
        return children;
    }
}

export class MutationParametersTreeItemData extends MutationsTreeItemData {
    contextValue = "mutationParameters";
    constructor(public mutation: Mutation) {
        super("Parameters");
        this.iconPath = new vscode.ThemeIcon("output");
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override async children(_apiClient: api.Client): Promise<MutationsTreeItemData[]> {
        const children = [];
        for (const [paramName, paramValue] of this.mutation.params) {
            children.push(new MutationDetailLeafTreeItemData(`${paramName}: ${paramValue}`));
        }
        return children;
    }
}

export class MutationCoordinateTreeItemData extends MutationsTreeItemData {
    contextValue = "mutationCoordinate";
    constructor(public name: string, public coordinate: api.EventCoordinate, public maybeSuccess?: boolean) {
        super(name);
        this.iconPath = new vscode.ThemeIcon("git-commit");
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override async children(_apiClient: api.Client): Promise<MutationsTreeItemData[]> {
        const children = [];

        let msg = "NA";
        let icon = new vscode.ThemeIcon("question", new vscode.ThemeColor("testing.iconQueued"));
        if (this.maybeSuccess === true) {
            msg = "Yes";
            icon = new vscode.ThemeIcon("verified-filled", new vscode.ThemeColor("testing.iconPassed"));
        } else if (this.maybeSuccess === false) {
            msg = "No";
            icon = new vscode.ThemeIcon("testing-failed-icon", new vscode.ThemeColor("testing.iconFailed"));
        }

        const item = new MutationDetailLeafTreeItemData(`Was Successful: ${msg}`);
        item.iconPath = icon;
        children.push(item);

        return children;
    }
}

export class MutationDetailLeafTreeItemData extends MutationsTreeItemData {
    contextValue = "mutationDetail";
    constructor(public name: string) {
        super(name);
    }
}

class Mutation {
    mutatorId: api.MutatorId;
    mutatorName = "<unnamed>";
    mutatorDescription?: string = undefined;
    mutationId: api.MutationId;
    createdAt: Date;
    experimentName?: string = undefined;
    params: Map<string, api.AttrVal>;
    // N.B. currently just surfacing the overall summary, could consider
    // the per-region summary if we expand beyond single segments
    regionDetailsSummary?: api.MutationRegionDetails;

    constructor(private mutation: api.Mutation) {
        this.mutatorId = mutation.mutator_id;
        this.mutationId = mutation.mutation_id;
        this.createdAt = new Date(0);
        this.createdAt.setUTCSeconds(mutation.created_at_utc_seconds);
        if (mutation.linked_experiment) {
            this.experimentName = mutation.linked_experiment;
        }
        if (Object.prototype.hasOwnProperty.call(mutation.mutator_attributes, "mutator.name")) {
            this.mutatorName = mutation.mutator_attributes["mutator.name"] as string;
        }
        if (Object.prototype.hasOwnProperty.call(mutation.mutator_attributes, "mutator.description")) {
            this.mutatorDescription = mutation.mutator_attributes["mutator.description"] as string;
        }
        this.params = new Map();
        for (const [paramName, paramValue] of Object.entries(mutation.params)) {
            this.params.set(paramName, paramValue);
        }
        if (mutation.region_details_summary) {
            this.regionDetailsSummary = mutation.region_details_summary.overall;
        }
    }

    wasCleared(): boolean {
        if (this.regionDetailsSummary && this.regionDetailsSummary.clear_communicated_and_success) {
            return true;
        }
        return false;
    }
}
