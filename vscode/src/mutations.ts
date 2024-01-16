import * as vscode from "vscode";
import * as api from "./modalityApi";

class MutationsTreeMemento {
    constructor(private readonly memento: vscode.Memento) {}

    // TODO filters/selections
    // - all-of-history vs selected-segment
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
}

export class MutationsTreeDataProvider implements vscode.TreeDataProvider<MutationsTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<MutationsTreeItemData | MutationsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<MutationsTreeItemData | MutationsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    workspaceState?: MutationsTreeMemento;
    data: MutationsTreeItemData[];
    view: vscode.TreeView<MutationsTreeItemData>;

    selectedMutatorId?: api.MutatorId;

    constructor(private readonly apiClient: api.Client) {}

    register(context: vscode.ExtensionContext) {
        this.workspaceState = new MutationsTreeMemento(context.workspaceState);
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
            vscode.commands.registerCommand("auxon.mutations.setSelectedMutation", (mutationId) => {
                this.setSelectedMutation(mutationId);
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
            vscode.commands.registerCommand("auxon.mutations.clearMutation", (itemData) => {
                this.clearMutation(itemData);
            })
        );

        this.refresh();
    }

    refresh(): void {
        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutations.groupBy",
            this.workspaceState.getGroupByMutatorName() ? "MUTATOR_NAME" : "NONE"
        );
        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutations.filterBy",
            this.workspaceState.getFilterBySelectedMutator() ? "MUTATOR_ID" : "NONE"
        );

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: MutationsTreeItemData): vscode.TreeItem {
        return element.treeItem(this.workspaceState);
    }

    async getChildren(element?: MutationsTreeItemData): Promise<MutationsTreeItemData[]> {
        if (this.workspaceState.getFilterBySelectedMutator() && this.selectedMutatorId == null) {
            // Need a selected mutator to populate with
            return [];
        } else if (!element) {
            let mutations = [];
            if (this.workspaceState.getFilterBySelectedMutator()) {
                mutations = await this.apiClient.mutator(this.selectedMutatorId).mutations();
            } else {
                mutations = await this.apiClient.mutations().list();
            }

            let items = [];
            if (this.workspaceState.getGroupByMutatorName()) {
                const root = new MutationsGroupByNameTreeItemData("", []);
                for (const m of mutations) {
                    root.insertNode(new Mutation(m));
                }
                root.updateDescriptions();
                items = root.children();
            } else {
                items = mutations.map((m) => new NamedMutationTreeItemData(new Mutation(m)));
            }
            // TODO - sort by created-at when it's added
            const { compare } = Intl.Collator("en-US");
            this.data = items.sort((a, b) => compare(a.mutatorName, b.mutatorName));
            return this.data;
        } else {
            return element.children();
        }
    }

    getParent(element: MutationsTreeItemData): vscode.ProviderResult<MutationsTreeItemData> {
        if (this.workspaceState.getGroupByMutatorName()) {
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
        if (this.workspaceState.getFilterBySelectedMutator()) {
            if (this.selectedMutatorId != mutatorId) {
                this.selectedMutatorId = mutatorId;
                this.refresh();
            }
        } else if (this.workspaceState.getGroupByMutatorName() && this.selectedMutatorId != mutatorId) {
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

    setSelectedMutation(_mutationId: api.MutationId) {
        // TODO - add this when experiments are added
    }

    disableMutationGrouping() {
        this.workspaceState.setGroupByMutatorName(false);
        this.selectedMutatorId = null;
        this.refresh();
    }

    groupMutationsByName() {
        this.workspaceState.setGroupByMutatorName(true);
        this.selectedMutatorId = null;
        this.refresh();
    }

    disableMutationFiltering() {
        this.workspaceState.setFilterBySelectedMutator(false);
        this.selectedMutatorId = null;
        this.refresh();
    }

    filterBySelectedMutator() {
        this.workspaceState.setFilterBySelectedMutator(true);
        this.selectedMutatorId = null;
        this.refresh();
    }

    clearMutation(item: MutationsTreeItemData) {
        if (!(item instanceof NamedMutationTreeItemData)) {
            throw new Error("Internal error: mutations tree node not of expected type");
        }
        vscode.commands.executeCommand("auxon.deviant.clearMutation", { mutationId: item.mutationId });
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

        // Mutator selection populates mutations view
        if (this.contextValue == "mutation" && !workspaceData.getFilterBySelectedMutator()) {
            const command = {
                title: "Sets the selected mutator in the mutators tree view",
                command: "auxon.mutators.setSelectedMutator",
                arguments: [this.mutatorId],
            };
            item.command = command;
        }

        return item;
    }

    canHaveChildren(): boolean {
        return false;
    }

    children(): MutationsTreeItemData[] {
        return [];
    }
}

export class MutationsGroupByNameTreeItemData extends MutationsTreeItemData {
    contextValue = "mutationsGroup";
    constructor(public name: string, public childItems: MutationsTreeItemData[]) {
        super(name);
        super.iconPath = new vscode.ThemeIcon("replace-all");
        const tooltip = `- **Mutator Name**: ${name}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutationsTreeItemData[] {
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
        super.iconPath = new vscode.ThemeIcon("zap");
    }

    override canHaveChildren(): boolean {
        // TODO - always true once created-at/etc is added
        return this.mutation.experimentName != null || this.mutation.params.size != 0;
    }

    override children(): MutationsTreeItemData[] {
        const children = [];
        if (this.mutation.experimentName) {
            children.push(new MutationDetailLeafTreeItemData(`Experiment: ${this.mutation.experimentName}`));
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
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutationsTreeItemData[] {
        const children = [];
        for (const [paramName, paramValue] of this.mutation.params) {
            children.push(new MutationDetailLeafTreeItemData(`${paramName}: ${paramValue}`));
        }
        return children;
    }
}

export class MutationDetailLeafTreeItemData extends MutationsTreeItemData {
    contextValue = "mutationDetail";
    constructor(public name: string) {
        super(name);
    }
}

// TODO
// - add created-at datetime, sort the list
// - add checklist coordinate fields
class Mutation {
    mutatorId: api.MutatorId;
    mutatorName = "<unnamed>";
    mutatorDescription?: string = undefined;
    mutationId: api.MutationId;
    experimentName?: string = undefined;
    params: Map<string, api.AttrVal>;

    constructor(private mutation: api.Mutation) {
        this.mutatorId = mutation.mutator_id;
        this.mutationId = mutation.mutation_id;
        if (mutation.experiment_name) {
            this.experimentName = mutation.experiment_name;
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
    }
}
