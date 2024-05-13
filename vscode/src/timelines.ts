/**
 * TreeDataProvider for the timeline list , in the left side panel.
 */

import * as api from "./modalityApi";
import * as vscode from "vscode";
import * as modalityLog from "./modalityLog";
import * as config from "./config";
import * as transitionGraph from "./transitionGraph";
import * as workspaceState from "./workspaceState";
import * as child_process from "child_process";
import * as util from "util";

const execFile = util.promisify(child_process.execFile);

class TimelinesTreeMemento {
    constructor(private readonly memento: vscode.Memento) {}

    getGroupByTimelineNameComponents(): boolean {
        return this.memento.get("timelinesTree_groupByTimelineNameComponents", false);
    }

    async setGroupByTimelineNameComponents(val: boolean): Promise<void> {
        return this.memento.update("timelinesTree_groupByTimelineNameComponents", val);
    }

    getGroupingAttrKeys(): string[] {
        return this.memento.get("timelinesTree_groupingAttrKeys", []);
    }

    async setGroupingAttrKeys(val: string[]): Promise<void> {
        return this.memento.update("timelinesTree_groupingAttrKeys", val);
    }
}

enum TimelinesGroupingMode {
    FlatList = "FLAT_LIST",
    ByAttributes = "BY_ATTRIBUTES",
    ByNameComponents = "BY_NAME_COMPONENTS",
}

export class TimelinesTreeDataProvider implements vscode.TreeDataProvider<TimelineTreeItemData> {
    view: vscode.TreeView<TimelineTreeItemData>;
    uiState: TimelinesTreeMemento;

    private _onDidChangeTreeData: vscode.EventEmitter<TimelineTreeItemData | TimelineTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<TimelineTreeItemData | TimelineTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    constructor(
        private readonly apiClient: api.Client,
        private wss: workspaceState.WorkspaceAndSegmentState,
        context: vscode.ExtensionContext
    ) {
        this.uiState = new TimelinesTreeMemento(context.workspaceState);
        this.view = vscode.window.createTreeView("auxon.timelines", {
            treeDataProvider: this,
            canSelectMany: true,
        });

        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.timelines.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.timelines.inspect", (itemData) =>
                this.inspectTimelineCommand(itemData)
            ),
            vscode.commands.registerCommand("auxon.timelines.logSelected", () => this.logSelectedCommand()),
            vscode.commands.registerCommand("auxon.timelines.transitionGraph", (itemData) =>
                this.transitionGraph(itemData)
            ),
            vscode.commands.registerCommand("auxon.timelines.transitionGraphForSelection", () =>
                this.transitionGraphForSelection()
            ),
            vscode.commands.registerCommand("auxon.timelines.setGroupingAttrs", () => {
                this.setGroupingAttrs();
            }),
            vscode.commands.registerCommand("auxon.timelines.clearGroupingAttrs", () => {
                this.disableTimelineGrouping();
            }),
            vscode.commands.registerCommand("auxon.timelines.groupTimelinesByNameComponents", () => {
                this.groupTimelinesByNameComponents();
            }),
            vscode.commands.registerCommand("auxon.timelines.clearGroupTimelinesByNameComponents", () => {
                this.disableTimelineGrouping();
            }),
            vscode.commands.registerCommand("auxon.timelines.delete", (itemData) => {
                if (itemData.timelineId) {
                    this.deleteTimelines([itemData.timelineId]);
                }
            }),
            vscode.commands.registerCommand("auxon.timelines.deleteMany", (itemData?: TimelineTreeItemData) => {
                let timelineIds = this.view.selection.flatMap((data) => data.getTimelineIds());
                if (itemData) {
                    timelineIds = timelineIds.concat(itemData.getTimelineIds());
                }
                this.deleteTimelines(timelineIds);
            }),
            this.wss.onDidChangeUsedSegments(() => this.refresh())
        );
        this.updateGroupingMenuContext();
    }

    refresh(): void {
        this.updateGroupingMenuContext();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TimelineTreeItemData): vscode.TreeItem {
        return element.treeItem();
    }

    async getChildren(element?: TimelineTreeItemData): Promise<TimelineTreeItemData[]> {
        const children = await this.getChildrenInner(element);
        if (children.length === 0) {
            this.view.message = "Select one or more segments to view their timelines.";
        } else {
            this.view.message = undefined;
        }
        return children;
    }

    private async getChildrenInner(element?: TimelineTreeItemData): Promise<TimelineTreeItemData[]> {
        if (element) {
            return element.children(this.apiClient);
        }

        // root element
        const groupingAttrKeys = this.uiState.getGroupingAttrKeys();
        const groupByTimelineNameComponents = this.uiState.getGroupByTimelineNameComponents();
        if (groupingAttrKeys.length > 0) {
            let groups: api.TimelineGroup[] = [];
            switch (this.wss.activeSegments.type) {
                case "WholeWorkspace":
                    groups = await this.apiClient
                        .workspace(this.wss.activeWorkspaceVersionId)
                        .groupedTimelines(groupingAttrKeys);
                    break;

                case "Explicit":
                    for (const segmentId of this.wss.activeSegments.segmentIds) {
                        const api_groups = await this.apiClient.segment(segmentId).groupedTimelines(groupingAttrKeys);
                        for (const tl_group of api_groups) {
                            groups.push(tl_group);
                        }
                    }
                    break;
            }

            return groups.map((tl_group) => new TimelineGroupTreeItemData(tl_group));
        } else {
            // Not grouping by attr keys; just get the timelines
            let timelines: api.TimelineOverview[] = [];
            switch (this.wss.activeSegments.type) {
                case "WholeWorkspace":
                    timelines = await this.apiClient.workspace(this.wss.activeWorkspaceVersionId).timelines();
                    break;

                case "Explicit":
                    for (const segmentId of this.wss.activeSegments.segmentIds) {
                        for (const timeline of await this.apiClient.segment(segmentId).timelines()) {
                            timelines.push(timeline);
                        }
                    }
                    break;
            }
            timelines.sort((a, b) => {
                if (!a?.name) {
                    return 1;
                }
                if (!b?.name) {
                    return -1;
                }
                return a.name.localeCompare(b.name);
            });

            if (groupByTimelineNameComponents) {
                const root = new TimelineGroupByNameTreeItemData("");
                for (const timeline of timelines) {
                    let timelineNamePath: string[] = [];
                    if (timeline.name) {
                        timelineNamePath = timeline.name.split(".");
                    }
                    root.insertNode(timeline, timelineNamePath);
                }
                root.updateDescriptions();
                return root.children(this.apiClient);
            } else {
                return timelines.map((timeline_overview) => new TimelineLeafTreeItemData(timeline_overview));
            }
        }
    }

    async inspectTimelineCommand(item: TimelineTreeItemData) {
        if (item instanceof TimelineLeafTreeItemData) {
            const timeline = await this.apiClient.timeline(item.timeline_overview.id).get();
            const timelineJson = JSON.stringify(timeline, null, 4);

            const doc = await vscode.workspace.openTextDocument({
                language: "json",
                content: timelineJson,
            });
            await vscode.window.showTextDocument(doc);
        }
    }

    logSelectedCommand() {
        let timelineIds = this.view.selection.flatMap((data) => data.getTimelineIds());
        timelineIds = [...new Set(timelineIds)]; // dedupe

        vscode.commands.executeCommand(
            modalityLog.MODALITY_LOG_COMMAND,
            new modalityLog.ModalityLogCommandArgs({ thingToLog: timelineIds })
        );
    }

    async deleteTimelines(timelineIds: api.TimelineId[]) {
        timelineIds = [...new Set(timelineIds)]; // dedupe

        if (timelineIds.length == 0) {
            return;
        }

        let prefix = `Really delete ${timelineIds.length} timeline`;
        if (timelineIds.length > 1) {
            prefix += "s";
        }

        const answer = await vscode.window.showInformationMessage(
            `${prefix}? This will delete all events on the selected timelines.`,
            "Delete",
            "Cancel"
        );
        if (answer == "Delete") {
            let filterExpr = "";
            timelineIds.forEach((tid, index) => {
                const literalTimelineId = "%" + tid.replace(/-/g, "");
                filterExpr += `_.timeline.id = ${literalTimelineId}`;
                if (index < timelineIds.length - 1) {
                    filterExpr += " OR ";
                }
            });

            const modality = config.toolPath("modality");
            await execFile(modality, ["delete", "--force", filterExpr, ...config.extraCliArgs("modality delete")], {
                encoding: "utf8",
            });
            this.refresh();
        }
    }

    transitionGraph(item: TimelineTreeItemData) {
        transitionGraph.promptForGraphGrouping((groupBy) => {
            transitionGraph.showGraphForTimelines(item.getTimelineIds(), groupBy);
        });
    }

    transitionGraphForSelection() {
        let timelineIds = this.view.selection.flatMap((data) => data.getTimelineIds());
        timelineIds = [...new Set(timelineIds)]; // dedupe

        transitionGraph.promptForGraphGrouping((groupBy) => {
            transitionGraph.showGraphForTimelines(timelineIds, groupBy);
        });
    }

    async disableTimelineGrouping() {
        this.uiState.setGroupingAttrKeys([]);
        this.uiState.setGroupByTimelineNameComponents(false);
        this.refresh();
    }

    async setGroupingAttrs() {
        this.uiState.setGroupByTimelineNameComponents(false);
        const tlAttrs = await this.getAvailableTimelineAttrKeys();
        const groupingAttrKeys = this.uiState.getGroupingAttrKeys();
        const pickItems: vscode.QuickPickItem[] = tlAttrs.map((tlAttr) => {
            const picked = groupingAttrKeys.find((el) => el == tlAttr) !== undefined;
            const label = tlAttr;
            return { label, picked };
        });

        const pickedItems = await vscode.window.showQuickPick(pickItems, { canPickMany: true });
        if (pickedItems) {
            // User actually selected some attributes to use
            this.uiState.setGroupingAttrKeys(pickedItems.map((pi) => pi.label).sort());
            this.refresh();
        }
    }

    groupTimelinesByNameComponents() {
        this.uiState.setGroupingAttrKeys([]);
        this.uiState.setGroupByTimelineNameComponents(true);
        this.refresh();
    }

    async getAvailableTimelineAttrKeys(): Promise<string[]> {
        switch (this.wss.activeSegments.type) {
            case "WholeWorkspace":
                return await this.apiClient.workspace(this.wss.activeWorkspaceVersionId).timelineAttrKeys();

            case "Explicit": {
                if (this.wss.activeSegments.isAllSegments) {
                    return await this.apiClient.workspace(this.wss.activeWorkspaceVersionId).timelineAttrKeys();
                } else {
                    const keys = new Set<string>();
                    for (const segmentId of this.wss.activeSegments.segmentIds) {
                        for (const key of await this.apiClient.segment(segmentId).timelineAttrKeys()) {
                            keys.add(key);
                        }
                    }

                    return [...keys];
                }
            }
        }
    }

    // We use this to manage the context menu sort option checkboxes.
    // It's not elegant, but it's all we can do for now
    updateGroupingMenuContext() {
        let groupingMode = TimelinesGroupingMode.FlatList;
        if (this.uiState.getGroupByTimelineNameComponents()) {
            groupingMode = TimelinesGroupingMode.ByNameComponents;
        } else if (this.uiState.getGroupingAttrKeys().length > 0) {
            groupingMode = TimelinesGroupingMode.ByAttributes;
        }
        vscode.commands.executeCommand("setContext", "auxon.timelinesGroupingMode", groupingMode);
    }
}

// This is the base of all the tree item data classes
abstract class TimelineTreeItemData {
    abstract name: string;
    abstract contextValue: string;
    childItems: TimelineTreeItemData[] = [];
    timelineId?: api.TimelineId = undefined;
    description?: string = undefined;
    tooltip?: vscode.MarkdownString = undefined;
    iconPath?: vscode.ThemeIcon = undefined;

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

        return item;
    }

    canHaveChildren(): boolean {
        return false;
    }

    async children(_apiClient: api.Client): Promise<TimelineTreeItemData[]> {
        return [];
    }

    postwalk(f: (n: TimelineTreeItemData) => void) {
        // We don't need to get the children of TimelineLeafTreeItemData (attributes),
        // this lets us skip doing an API call and some data formatting
        if (!(this instanceof TimelineLeafTreeItemData)) {
            for (const child of this.childItems) {
                child.postwalk(f);
            }
        }
        f(this);
    }

    getTimelineIds(): api.TimelineId[] {
        const ids: api.TimelineId[] = [];
        this.postwalk((n: TimelineTreeItemData) => {
            if (n.timelineId) {
                ids.push(n.timelineId);
            }
        });
        return ids;
    }

    getModalityLogCommandArgs(): modalityLog.ModalityLogCommandArgs {
        return new modalityLog.ModalityLogCommandArgs({
            thingToLog: this.getTimelineIds(),
        });
    }

    updateDescriptions() {
        this.postwalk((n) => {
            // Skip over TimelineLeafTreeItemData so we don't request attributes
            // for every timeline
            if (!(n instanceof TimelineLeafTreeItemData) && n.childItems.length > 0) {
                const timelineCount = n.getTimelineIds().length;
                n.description = `${timelineCount} timeline`;
                if (timelineCount > 1) {
                    n.description += "s";
                }
            }
        });
    }
}

export class TimelineGroupByNameTreeItemData extends TimelineTreeItemData {
    contextValue = "timelineGroupByName";

    constructor(public name: string) {
        super();
        this.iconPath = new vscode.ThemeIcon("git-pull-request-draft");
    }

    override canHaveChildren(): boolean {
        return this.childItems.length !== 0;
    }

    override async children(_apiClient: api.Client): Promise<TimelineTreeItemData[]> {
        return this.childItems;
    }

    insertNode(timeline: api.TimelineOverview, timelineNamePath: string[]) {
        const nextNodeName = timelineNamePath.shift();

        if (!nextNodeName) {
            this.childItems.push(new TimelineLeafTreeItemData(timeline));
        } else {
            let nextNodeIndex = this.childItems.findIndex((item) => item.name == nextNodeName);
            if (nextNodeIndex == -1) {
                this.childItems.push(new TimelineGroupByNameTreeItemData(nextNodeName));
                nextNodeIndex = this.childItems.length - 1;
            }

            let nextNode = this.childItems[nextNodeIndex];
            if (!(nextNode instanceof TimelineGroupByNameTreeItemData)) {
                // Some non-namegroup node is there, with the same name. Replace it with a namegroup,
                // and insert the old node as a child.
                const newNode = new TimelineGroupByNameTreeItemData(nextNodeName);
                newNode.childItems = [nextNode];
                nextNode = newNode;
                this.childItems[nextNodeIndex] = nextNode;
            }

            // nextNode is now definitely a namegroup node. Convince typescript.
            if (!(nextNode instanceof TimelineGroupByNameTreeItemData)) {
                throw new Error("Internal error: timeline tree node not of expected type");
            }
            nextNode.insertNode(timeline, timelineNamePath);
        }
    }
}

export class TimelineGroupTreeItemData extends TimelineTreeItemData {
    name = "";
    contextValue = "timelineGroup";

    constructor(public timeline_group: api.TimelineGroup) {
        super();

        let name = null;
        for (const val of Object.values(this.timeline_group.group_attributes)) {
            if (val != "None") {
                if (name == null) {
                    name = "";
                } else {
                    name += ", ";
                }

                name += val.Some.toString();
            }
        }

        if (name == null) {
            name = "<non-matching timelines>";
        }
        this.name = name;
    }

    override canHaveChildren(): boolean {
        return this.timeline_group.timelines.length !== 0;
    }

    override async children(_apiClient: api.Client): Promise<TimelineTreeItemData[]> {
        const timelines = this.timeline_group.timelines.sort((a, b) => {
            if (!a?.name) {
                return 1;
            }
            if (!b?.name) {
                return -1;
            }
            return a.name.localeCompare(b.name);
        });
        this.childItems = timelines.map((timeline_overview) => new TimelineLeafTreeItemData(timeline_overview));
        return this.childItems;
    }
}

export class TimelineLeafTreeItemData extends TimelineTreeItemData {
    name = "<unnamed>";
    contextValue = "timeline";
    iconPath = new vscode.ThemeIcon("git-commit");

    constructor(public timeline_overview: api.TimelineOverview) {
        super();

        this.timelineId = this.timeline_overview.id;
        const label = this.timeline_overview.name;
        if (label) {
            this.name = label;
        }
        this.description = this.timeline_overview.id;

        let tooltip = `- **Timeline Name**: ${this.timeline_overview.name}`;
        tooltip += `\n- **Timeline Id**: ${this.timeline_overview.id}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }

    override canHaveChildren(): boolean {
        return true;
    }

    override async children(apiClient: api.Client): Promise<TimelineTreeItemData[]> {
        const timeline = await apiClient.timeline(this.timelineId as string).get();
        for (const [k, v] of Object.entries(timeline.attributes)) {
            this.childItems.push(new TimelineAttributeTreeItem(k, v));
        }
        return this.childItems;
    }
}

export class TimelineAttributeTreeItem extends TimelineTreeItemData {
    name = "";
    contextValue = "timelineAttribute";

    constructor(public key: string, public value: api.AttrVal) {
        super();
        let v;
        if (Object.prototype.hasOwnProperty.call(value, "TimelineId")) {
            // The type checker doesn't like the implicit 'any' type on the AttrVal union
            // @ts-ignore
            v = value["TimelineId"] as string;
        } else if (Object.prototype.hasOwnProperty.call(value, "Timestamp")) {
            // @ts-ignore
            v = value["Timestamp"] as string;
        } else if (Object.prototype.hasOwnProperty.call(value, "LogicalTime")) {
            // @ts-ignore
            v = JSON.stringify(value);
        } else if (Object.prototype.hasOwnProperty.call(value, "EventCoordinate")) {
            // @ts-ignore
            v = JSON.stringify(value);
        } else if (Object.prototype.hasOwnProperty.call(value, "BigInt")) {
            // @ts-ignore
            v = value["BigInt"] as string;
        } else {
            v = value as string;
        }
        this.name = `${key}: ${v}`;
    }
}
