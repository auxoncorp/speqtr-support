import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as workspaceState from "./workspaceState";

class MutatorsTreeMemento {
    constructor(private readonly memento: vscode.Memento) {}

    getFilterByDataScope(): boolean {
        return this.memento.get("mutatorsTree_filterByDataScope", true);
    }

    async setFilterByDataScope(val: boolean): Promise<void> {
        return this.memento.update("mutatorsTree_filterByDataScope", val);
    }

    getShowUnavailable(): boolean {
        return this.memento.get("mutatorsTree_showUnavailable", false);
    }

    async setShowUnavailable(val: boolean): Promise<void> {
        return this.memento.update("mutatorsTree_showUnavailable", val);
    }

    getGroupByMutatorName(): boolean {
        return this.memento.get("mutatorsTree_groupByMutatorName", true);
    }

    async setGroupByMutatorName(val: boolean): Promise<void> {
        return this.memento.update("mutatorsTree_groupByMutatorName", val);
    }

    getGroupByWorkspaceAttrs(): boolean {
        return this.memento.get("mutatorsTree_groupByWorkspaceAttrs", true);
    }

    async setGroupByWorkspaceAttrs(val: boolean): Promise<void> {
        return this.memento.update("mutatorsTree_groupByWorkspaceAttrs", val);
    }
}

export class MutatorsTreeDataProvider implements vscode.TreeDataProvider<MutatorsTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<MutatorsTreeItemData | MutatorsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<MutatorsTreeItemData | MutatorsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    uiState: MutatorsTreeMemento;
    data: MutatorsTreeItemData[] = [];
    view: vscode.TreeView<MutatorsTreeItemData>;
    workspaceMutatorGroupingAttrs: string[] = [];

    constructor(
        private readonly apiClient: api.Client,
        private wss: workspaceState.WorkspaceAndSegmentState,
        context: vscode.ExtensionContext
    ) {
        this.data = [];
        this.workspaceMutatorGroupingAttrs = [];
        this.uiState = new MutatorsTreeMemento(context.workspaceState);
        this.view = vscode.window.createTreeView("auxon.mutators", {
            treeDataProvider: this,
            canSelectMany: false,
        });

        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.mutators.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.mutators.filterByDataScope", () => this.filterByDataScope(true)),
            vscode.commands.registerCommand("auxon.mutators.unfilterByDataScope", () => this.filterByDataScope(false)),
            vscode.commands.registerCommand("auxon.mutators.showUnavailable", () => this.showUnavailable(true)),
            vscode.commands.registerCommand("auxon.mutators.hideUnavailable", () => this.showUnavailable(false)),
            vscode.commands.registerCommand("auxon.mutators.revealMutator", async (mutatorId) => {
                await this.revealMutator(mutatorId);
            }),
            vscode.commands.registerCommand("auxon.mutators.disableByNameGrouping", () => {
                this.disableMutatorGrouping();
            }),
            vscode.commands.registerCommand("auxon.mutators.groupByName", () => {
                this.groupMutatorsByName();
            }),
            vscode.commands.registerCommand("auxon.mutators.disableByWorkspaceAttrsGrouping", () => {
                this.disableMutatorGrouping();
            }),
            vscode.commands.registerCommand("auxon.mutators.groupByWorkspaceAttrs", () => {
                this.groupByWorkspaceAttrs();
            }),
            vscode.commands.registerCommand("auxon.mutators.createMutation", (itemData) => {
                this.createMutation(itemData);
            }),
            this.wss.onDidChangeUsedSegments(() => this.refresh())
        );

        this.refresh();
    }

    refresh(): void {
        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutators.unavailable",
            this.uiState.getShowUnavailable() ? "SHOW" : "HIDE"
        );

        let groupingMode = "NONE";
        if (this.uiState.getGroupByMutatorName()) {
            groupingMode = "MUTATOR_NAME";
        } else if (this.uiState.getGroupByWorkspaceAttrs() && this.workspaceMutatorGroupingAttrs.length != 0) {
            groupingMode = "WORKSPACE_ATTRS";
        }

        vscode.commands.executeCommand("setContext", "auxon.mutators.groupBy", groupingMode);

        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutators.filterByDataScope",
            this.uiState.getFilterByDataScope() ? "SET" : "UNSET"
        );

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: MutatorsTreeItemData): vscode.TreeItem {
        return element.treeItem();
    }

    private async getGroupedMutators(): Promise<api.MutatorGroup[]> {
        let groups = [];
        if (this.uiState.getFilterByDataScope()) {
            switch (this.wss.activeSegments.type) {
                case "WholeWorkspace":
                    groups = await this.apiClient
                        .workspace(this.wss.activeWorkspaceVersionId)
                        .groupedMutators(this.workspaceMutatorGroupingAttrs);
                    break;
                case "Explicit":
                    if (this.wss.activeSegments.isAllSegments) {
                        groups = await this.apiClient
                            .workspace(this.wss.activeWorkspaceVersionId)
                            .groupedMutators(this.workspaceMutatorGroupingAttrs);
                    } else {
                        for (const segmentId of this.wss.activeSegments.segmentIds) {
                            const segGroups = await this.apiClient
                                .segment(segmentId)
                                .groupedMutators(this.workspaceMutatorGroupingAttrs);
                            groups.push(...segGroups);
                        }
                    }
                    break;
            }
        } else {
            groups = await this.apiClient.mutators().groupedMutators(this.workspaceMutatorGroupingAttrs);
        }
        return groups;
    }

    private async getMutators(): Promise<api.Mutator[]> {
        let mutators = [];
        if (this.uiState.getFilterByDataScope()) {
            switch (this.wss.activeSegments.type) {
                case "WholeWorkspace":
                    mutators = await this.apiClient.mutators().list();
                    break;
                case "Explicit":
                    if (this.wss.activeSegments.isAllSegments) {
                        mutators = await this.apiClient.workspace(this.wss.activeWorkspaceVersionId).mutators();
                    } else {
                        for (const segmentId of this.wss.activeSegments.segmentIds) {
                            const segMutators = await this.apiClient.segment(segmentId).mutators();
                            mutators.push(...segMutators);
                        }
                    }
                    break;
            }
        } else {
            mutators = await this.apiClient.mutators().list();
        }
        return mutators;
    }

    async getChildren(element?: MutatorsTreeItemData): Promise<MutatorsTreeItemData[]> {
        const children = await this.getChildrenInner(element);
        if (children.length === 0) {
            this.view.message =
                "The active data scope doesn't contain any mutators. Select a different data scope or refresh the view after mutators have announced themselves.";
        } else {
            this.view.message = undefined;
        }
        return children;
    }

    private async getChildrenInner(element?: MutatorsTreeItemData): Promise<MutatorsTreeItemData[]> {
        if (!element) {
            this.data = [];

            if (this.uiState.getGroupByWorkspaceAttrs()) {
                if (this.workspaceMutatorGroupingAttrs.length == 0) {
                    // No workspace attrs yet
                    return [];
                }

                const groups = await this.getGroupedMutators();
                let available_groups = [];
                let unavailable_groups = [];

                for (const group of groups) {
                    const available_group = { ...group };

                    available_group.mutators = available_group.mutators.filter((m) => m.mutator_state === "Available");
                    available_groups.push(available_group);

                    if (this.uiState.getShowUnavailable()) {
                        const unavailable_group = { ...group };
                        unavailable_group.mutators = unavailable_group.mutators.filter(
                            (m) => m.mutator_state !== "Available"
                        );
                        unavailable_groups.push(unavailable_group);
                    }
                }

                available_groups = available_groups.filter((g) => g.mutators.length != 0);
                unavailable_groups = unavailable_groups.filter((g) => g.mutators.length != 0);

                if (this.uiState.getShowUnavailable()) {
                    let items = [];
                    items = available_groups.map((mut_group) => new MutatorsGroupTreeItemData(mut_group));
                    if (items.length !== 0) {
                        this.data.push(new MutatorsParentGroupTreeItemData("Available Mutators", items));
                    }

                    items = unavailable_groups.map((mut_group) => new MutatorsGroupTreeItemData(mut_group));
                    if (items.length !== 0) {
                        this.data.push(new MutatorsParentGroupTreeItemData("Unavailable Mutators", items));
                    }
                } else {
                    this.data = available_groups.map((mut_group) => new MutatorsGroupTreeItemData(mut_group));
                }

                return this.data;
            } else {
                const mutators = await this.getMutators();
                const available_mutators = mutators.filter((m) => m.mutator_state === "Available");
                const unavailable_mutators = mutators.filter((m) => m.mutator_state !== "Available");

                let items = [];
                if (this.uiState.getShowUnavailable()) {
                    items = this.generateMutatorsSubTree(available_mutators);
                    if (items.length !== 0) {
                        this.data.push(new MutatorsParentGroupTreeItemData("Available Mutators", items));
                    }

                    items = this.generateMutatorsSubTree(unavailable_mutators);
                    if (items.length !== 0) {
                        this.data.push(new MutatorsParentGroupTreeItemData("Unavailable Mutators", items));
                    }
                } else {
                    this.data = this.generateMutatorsSubTree(available_mutators);
                }

                return this.data;
            }
        } else {
            return element.children();
        }
    }

    private generateMutatorsSubTree(mutators: api.Mutator[]): MutatorsTreeItemData[] {
        let items = [];
        if (this.uiState.getGroupByMutatorName()) {
            const root = new MutatorsGroupByNameTreeItemData("", []);
            for (const m of mutators) {
                root.insertNode(new Mutator(m));
            }
            root.updateDescriptions();
            items = root.children();
        } else {
            items = mutators.map((m) => new NamedMutatorTreeItemData(new Mutator(m)));
        }
        const { compare } = Intl.Collator("en-US");
        return items.sort((a, b) => compare(a.name, b.name));
    }

    getParent(element: MutatorsTreeItemData): vscode.ProviderResult<MutatorsTreeItemData> {
        for (const item of this.data) {
            if (item.containsChild(element)) {
                return item;
            }
        }
        return undefined;
    }

    async revealMutator(mutatorId: api.MutatorId) {
        for (const item of this.data) {
            const done = await item.revealDescendants(mutatorId, this.view);
            if (done) {
                return;
            }
        }
    }

    setWorkspaceMutatorGroupingAttrs(workspaceMutatorGroupingAttrs: string[]) {
        this.workspaceMutatorGroupingAttrs = workspaceMutatorGroupingAttrs;
        this.refresh();
    }

    filterByDataScope(isSet: boolean) {
        this.uiState.setFilterByDataScope(isSet);
        this.refresh();
    }

    showUnavailable(show: boolean) {
        this.uiState.setShowUnavailable(show);
        this.refresh();
    }

    disableMutatorGrouping() {
        this.uiState.setGroupByMutatorName(false);
        this.uiState.setGroupByWorkspaceAttrs(false);
        this.refresh();
    }

    groupMutatorsByName() {
        this.uiState.setGroupByMutatorName(true);
        this.uiState.setGroupByWorkspaceAttrs(false);
        this.refresh();
    }

    groupByWorkspaceAttrs() {
        if (this.workspaceMutatorGroupingAttrs.length != 0) {
            this.uiState.setGroupByMutatorName(false);
            this.uiState.setGroupByWorkspaceAttrs(true);
            this.refresh();
        }
    }

    createMutation(item: MutatorsTreeItemData) {
        if (!(item instanceof NamedMutatorTreeItemData)) {
            throw new Error("Internal error: mutators tree node not of expected type");
        }
        // N.B. we could check for (un)available status here first, but currently we
        // just pipe the CLI stderr message through
        vscode.commands.executeCommand("auxon.deviant.runCreateMutationWizard", item.mutator);
    }
}

// This is the base of all the tree item data classes
abstract class MutatorsTreeItemData {
    abstract contextValue: string;

    id?: string = undefined;
    mutatorId?: api.MutatorId = undefined;
    description?: string = undefined;
    tooltip?: vscode.MarkdownString = undefined;
    iconPath?: vscode.ThemeIcon = undefined;

    constructor(public name: string) {}

    treeItem(): vscode.TreeItem {
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
        if (this.contextValue == "mutator") {
            const command = {
                title: "Set the selected mutator in the mutations tree view",
                command: "auxon.mutations.setSelectedMutator",
                arguments: [this.mutatorId],
            };
            item.command = command;
        }

        return item;
    }

    canHaveChildren(): boolean {
        return false;
    }

    children(): MutatorsTreeItemData[] {
        return [];
    }

    // NOTE: this only needs to be implemented by items that can be revealed and their parents
    containsChild(_element: MutatorsTreeItemData): boolean {
        return false;
    }

    containsMutatorId(_mutatorId: api.MutatorId): boolean {
        return false;
    }

    // Treeview doesn't appear to handle selecting nested items well.
    // Instead we need to reveal the parent first then the item
    async revealDescendants(mutatorId: api.MutatorId, view: vscode.TreeView<MutatorsTreeItemData>): Promise<boolean> {
        if (this.mutatorId === mutatorId) {
            // Reveal the item
            await view.reveal(this, { focus: true, select: true, expand: 10 });
            return true;
        }

        if (this.containsMutatorId(mutatorId)) {
            // Reveal the parent
            await view.reveal(this, { focus: true, select: true, expand: 1 });
            for (const child of this.children()) {
                const done = await child.revealDescendants(mutatorId, view);
                if (done) {
                    return true;
                }
            }
        }

        return false;
    }
}

export class MutatorsParentGroupTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutatorsParentGroup";

    constructor(public name: string, public childItems: MutatorsTreeItemData[]) {
        super(name);

        const { compare } = Intl.Collator("en-US");
        childItems.sort((a, b) => compare(a.name, b.name));
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutatorsTreeItemData[] {
        return this.childItems;
    }

    override containsChild(element: MutatorsTreeItemData): boolean {
        for (const child of this.childItems) {
            if (child.containsChild(element)) {
                return true;
            }
        }
        return false;
    }

    override containsMutatorId(mutatorId: api.MutatorId): boolean {
        for (const child of this.childItems) {
            if (child.containsMutatorId(mutatorId)) {
                return true;
            }
        }
        return false;
    }
}

export class MutatorsGroupTreeItemData extends MutatorsTreeItemData {
    name = "";
    contextValue = "mutatorsAttrGroup";
    childItems: MutatorsTreeItemData[];

    constructor(public group: api.MutatorGroup) {
        super("");

        let groupName = null;
        for (const val of Object.values(this.group.group_attributes)) {
            if (val != "None") {
                if (groupName == null) {
                    groupName = "";
                } else {
                    groupName += ", ";
                }

                groupName += val.Some.toString();
            }
        }

        if (groupName == null) {
            groupName = "<non-matching mutators>";
        }
        this.name = groupName;

        this.description = `${group.mutators.length} mutator`;
        if (group.mutators.length > 1) {
            this.description += "s";
        }

        const unsorted_mutators = this.group.mutators.map((m) => new Mutator(m));
        const { compare } = Intl.Collator("en-US");
        const mutators = unsorted_mutators.sort((a, b) => compare(a.name, b.name));
        this.childItems = mutators.map((m) => new NamedMutatorTreeItemData(m));
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutatorsTreeItemData[] {
        return this.childItems;
    }

    override containsChild(element: MutatorsTreeItemData): boolean {
        return this.childItems.includes(element);
    }

    override containsMutatorId(mutatorId: api.MutatorId): boolean {
        for (const child of this.childItems) {
            if (child.containsMutatorId(mutatorId)) {
                return true;
            }
        }
        return false;
    }
}

export class MutatorsGroupByNameTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutatorsGroup";
    constructor(public name: string, public childItems: MutatorsTreeItemData[]) {
        super(name);
        this.iconPath = new vscode.ThemeIcon("github-action");
        const tooltip = `- **Mutator Name**: ${name}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutatorsTreeItemData[] {
        return this.childItems;
    }

    insertNode(mutator: Mutator) {
        let nextNodeIndex = this.childItems.findIndex((item) => item.name == mutator.name);
        if (nextNodeIndex == -1) {
            this.childItems.push(new MutatorsGroupByNameTreeItemData(mutator.name, []));
            nextNodeIndex = this.childItems.length - 1;
        }

        const nextNode = this.childItems[nextNodeIndex];
        if (!(nextNode instanceof MutatorsGroupByNameTreeItemData)) {
            throw new Error("Internal error: mutators tree node not of expected type");
        }
        nextNode.childItems.push(new NamedMutatorTreeItemData(mutator));
    }

    updateDescriptions() {
        for (const group of this.childItems) {
            if (group instanceof MutatorsGroupByNameTreeItemData && group.childItems.length > 0) {
                const mutatorCount = group.childItems.length;
                group.description = `${mutatorCount} mutator`;
                if (mutatorCount > 1) {
                    group.description += "s";
                }
            }
        }
    }

    override containsChild(element: MutatorsTreeItemData): boolean {
        return this.childItems.includes(element);
    }

    override containsMutatorId(mutatorId: api.MutatorId): boolean {
        for (const child of this.childItems) {
            if (child.containsMutatorId(mutatorId)) {
                return true;
            }
        }
        return false;
    }
}

export class NamedMutatorTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutator";
    constructor(public mutator: Mutator) {
        super(mutator.name);
        this.id = `${mutator.id}`;
        this.mutatorId = mutator.id;
        this.description = mutator.id;
        let tooltip = `- **Mutator Name**: ${mutator.name}`;
        tooltip += `\n- **Mutator Id**: ${mutator.id}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
        this.iconPath = new vscode.ThemeIcon("outline-view-icon");
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutatorsTreeItemData[] {
        const children = [];
        if (this.mutator.description) {
            children.push(new MutatorDetailLeafTreeItemData(`${this.mutator.description}`));
        }
        if (this.mutator.layer) {
            children.push(new MutatorDetailLeafTreeItemData(`Layer: ${this.mutator.layer}`));
        }
        if (this.mutator.operation) {
            children.push(new MutatorDetailLeafTreeItemData(`Operation: ${this.mutator.operation}`));
        }
        if (this.mutator.group) {
            children.push(new MutatorDetailLeafTreeItemData(`Group: ${this.mutator.group}`));
        }
        children.push(new MutatorDetailLeafTreeItemData(`State: ${this.mutator.state}`));
        if (this.mutator.orgMetadataAttrs.size != 0) {
            children.push(new MutatorOrgMetadataTreeItemData(this.mutator.orgMetadataAttrs));
        }
        if (this.mutator.params.length != 0) {
            children.push(new MutatorParametersTreeItemData(this.mutator.params));
        }
        return children;
    }

    override containsMutatorId(mutatorId: api.MutatorId): boolean {
        return this.mutatorId === mutatorId;
    }
}

export class MutatorOrgMetadataTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutatorOrgMetadata";
    constructor(public orgMetadataAttrs: Map<string, api.AttrVal>) {
        super("Organization Metadata");
        this.iconPath = new vscode.ThemeIcon("organization");
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutatorsTreeItemData[] {
        const children = [];
        for (const [k, v] of this.orgMetadataAttrs) {
            children.push(new MutatorDetailLeafTreeItemData(`${k}: ${v}`));
        }
        return children;
    }
}

export class MutatorParametersTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutatorParameters";
    constructor(public params: MutatorParameter[]) {
        super("Parameters");
        this.iconPath = new vscode.ThemeIcon("output");
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutatorsTreeItemData[] {
        const children = [];
        for (const p of this.params) {
            children.push(new MutatorParameterTreeItemData(p));
        }
        return children;
    }
}

export class MutatorParameterTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutatorParameter";
    constructor(public param: MutatorParameter) {
        super(param.name);
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override children(): MutatorsTreeItemData[] {
        const children = [];
        if (this.param.description) {
            children.push(new MutatorDetailLeafTreeItemData(`${this.param.description}`));
        }
        children.push(new MutatorDetailLeafTreeItemData(`value_type: ${this.param.valueType}`));
        for (const [k, v] of this.param.attrs) {
            children.push(new MutatorDetailLeafTreeItemData(`${k}: ${v}`));
        }
        return children;
    }
}

export class MutatorDetailLeafTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutatorDetail";
    constructor(public name: string) {
        super(name);
    }
}

export class Mutator {
    id: api.MutatorId;
    state: api.MutatorState;
    name = "<unnamed>";
    description?: string = undefined;
    layer?: string = undefined;
    operation?: string = undefined;
    group?: string = undefined;
    orgMetadataAttrs: Map<string, api.AttrVal>;
    params: MutatorParameter[];

    constructor(mutator: api.Mutator) {
        this.id = mutator.mutator_id;
        this.state = mutator.mutator_state;
        this.orgMetadataAttrs = new Map();
        this.params = [];
        const paramAttrsByPrefix: Map<string, Map<string, api.AttrVal>> = new Map();

        for (const key in mutator.mutator_attributes) {
            if (key == "mutator.name") {
                this.name = mutator.mutator_attributes[key] as string;
            } else if (key == "mutator.description") {
                this.description = mutator.mutator_attributes[key] as string;
            } else if (key == "mutator.layer") {
                this.layer = mutator.mutator_attributes[key] as string;
            } else if (key == "mutator.operation") {
                this.operation = mutator.mutator_attributes[key] as string;
            } else if (key == "mutator.group") {
                this.group = mutator.mutator_attributes[key] as string;
            } else if (key.startsWith("mutator.params")) {
                const pk = key.replace("mutator.params.", "");
                const pnamePrefix = pk.split(".", 1)[0];
                let paramAttrs = paramAttrsByPrefix.get(pnamePrefix);
                if (paramAttrs == null) {
                    paramAttrs = new Map();
                    paramAttrsByPrefix.set(pnamePrefix, paramAttrs);
                }

                paramAttrs.set(pk.replace(`${pnamePrefix}.`, ""), mutator.mutator_attributes[key]);
            } else {
                // Remaining are organization_custom_metadata attributes
                this.orgMetadataAttrs.set(key.replace("mutator.", ""), mutator.mutator_attributes[key]);
            }
        }

        for (const [_prefix, attrs] of paramAttrsByPrefix) {
            if (attrs.size != 0) {
                this.params.push(new MutatorParameter(attrs));
            }
        }
    }
}

export class MutatorParameter {
    name = "<unnamed>";
    description?: string = undefined;
    valueType?: string;
    attrs: Map<string, api.AttrVal>;

    constructor(private paramAttrs: Map<string, api.AttrVal>) {
        this.attrs = new Map();
        for (const [k, v] of paramAttrs) {
            if (k == "name") {
                this.name = v as string;
            } else if (k == "description") {
                this.description = v as string;
            } else if (k == "value_type") {
                this.valueType = v as string;
            } else {
                this.attrs.set(k, v);
            }
        }
    }
}
