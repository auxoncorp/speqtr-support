import * as vscode from "vscode";
import * as api from "./modalityApi";

class MutatorsTreeMemento {
    constructor(private readonly memento: vscode.Memento) {}

    getShowUnavailable(): boolean {
        return this.memento.get("mutatorsTree_showUnavailable", false);
    }

    async setShowUnavailable(val: boolean): Promise<void> {
        return this.memento.update("mutatorsTree_showUnavailable", val);
    }

    getGroupByMutatorName(): boolean {
        return this.memento.get("mutatorsTree_groupByMutatorName", false);
    }

    async setGroupByMutatorName(val: boolean): Promise<void> {
        return this.memento.update("mutatorsTree_groupByMutatorName", val);
    }
}

export class MutatorsTreeDataProvider implements vscode.TreeDataProvider<MutatorsTreeItemData> {
    private _onDidChangeTreeData: vscode.EventEmitter<MutatorsTreeItemData | MutatorsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<MutatorsTreeItemData | MutatorsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    workspaceState?: MutatorsTreeMemento;
    data: MutatorsTreeItemData[];
    view: vscode.TreeView<MutatorsTreeItemData>;

    constructor(private readonly apiClient: api.Client) {}

    register(context: vscode.ExtensionContext) {
        this.workspaceState = new MutatorsTreeMemento(context.workspaceState);
        this.view = vscode.window.createTreeView("auxon.mutators", {
            treeDataProvider: this,
            canSelectMany: false,
        });

        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.mutators.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.mutators.showUnavailable", () => this.showUnavailable(true)),
            vscode.commands.registerCommand("auxon.mutators.hideUnavailable", () => this.showUnavailable(false)),
            vscode.commands.registerCommand("auxon.mutators.setSelectedMutator", (mutatorId) => {
                this.setSelectedMutator(mutatorId);
            }),
            vscode.commands.registerCommand("auxon.mutators.disableMutatorGrouping", () => {
                this.disableMutatorGrouping();
            }),
            vscode.commands.registerCommand("auxon.mutators.groupMutatorsByName", () => {
                this.groupMutatorsByName();
            }),
            vscode.commands.registerCommand("auxon.mutators.createMutation", (itemData) => {
                this.createMutation(itemData);
            })
        );

        this.refresh();
    }

    refresh(): void {
        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutators.unavailable",
            this.workspaceState.getShowUnavailable() ? "SHOW" : "HIDE"
        );
        vscode.commands.executeCommand(
            "setContext",
            "auxon.mutators.groupBy",
            this.workspaceState.getGroupByMutatorName() ? "MUTATOR_NAME" : "NONE"
        );

        this._onDidChangeTreeData.fire(undefined);
    }

    showUnavailable(show: boolean) {
        this.workspaceState.setShowUnavailable(show);
        this.refresh();
    }

    getTreeItem(element: MutatorsTreeItemData): vscode.TreeItem {
        return element.treeItem();
    }

    async getChildren(element?: MutatorsTreeItemData): Promise<MutatorsTreeItemData[]> {
        if (!element) {
            let mutators = await this.apiClient.mutators().list();
            if (!this.workspaceState.getShowUnavailable()) {
                mutators = mutators.filter((m) => m.mutator_state === "Available");
            }
            let items = [];
            if (this.workspaceState.getGroupByMutatorName()) {
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
            this.data = items.sort((a, b) => compare(a.name, b.name));
            return this.data;
        } else {
            return element.children();
        }
    }

    getParent(element: MutatorsTreeItemData): vscode.ProviderResult<MutatorsTreeItemData> {
        if (this.workspaceState.getGroupByMutatorName()) {
            for (const group of this.data) {
                if (!(group instanceof MutatorsGroupByNameTreeItemData)) {
                    throw new Error("Internal error: mutators tree node not of expected type");
                }
                if (group.childItems.includes(element)) {
                    return group;
                }
            }
        }
        return undefined;
    }

    setSelectedMutator(mutatorId: api.MutatorId) {
        if (this.workspaceState.getGroupByMutatorName()) {
            for (const group of this.data) {
                if (!(group instanceof MutatorsGroupByNameTreeItemData)) {
                    throw new Error("Internal error: mutators tree node not of expected type");
                }
                const item = group.childItems.find((i) => i.mutatorId == mutatorId);
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
            const item = this.data.find((i) => i.mutatorId == mutatorId);
            if (item) {
                this.view.reveal(item, { focus: true, select: true, expand: 10 });
            }
        }
    }

    disableMutatorGrouping() {
        this.workspaceState.setGroupByMutatorName(false);
        this.refresh();
    }

    groupMutatorsByName() {
        this.workspaceState.setGroupByMutatorName(true);
        this.refresh();
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
}

export class MutatorsGroupByNameTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutatorsGroup";
    constructor(public name: string, public childItems: MutatorsTreeItemData[]) {
        super(name);
        super.iconPath = new vscode.ThemeIcon("github-action");
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
}

export class MutatorOrgMetadataTreeItemData extends MutatorsTreeItemData {
    contextValue = "mutatorOrgMetadata";
    constructor(public orgMetadataAttrs: Map<string, api.AttrVal>) {
        super("Organization Metadata");
        super.iconPath = new vscode.ThemeIcon("organization");
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
        super.iconPath = new vscode.ThemeIcon("output");
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

    constructor(private mutator: api.Mutator) {
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
                if (!paramAttrsByPrefix.has(pnamePrefix)) {
                    paramAttrsByPrefix.set(pnamePrefix, new Map());
                }
                const paramAttrs = paramAttrsByPrefix.get(pnamePrefix);
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
    valueType: string;
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
