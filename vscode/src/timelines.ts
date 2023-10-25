/**
 * TreeDataProvider for the timeline list , in the left side panel.
 */

import * as api from "./modalityApi";
import * as vscode from "vscode";
import * as cliConfig from "./cliConfig";
import * as modalityLog from "./modalityLog";
import * as transitionGraph from "./transitionGraph";

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

export class TimelinesTreeDataProvider implements vscode.TreeDataProvider<TimelineTreeItemData> {
    activeWorkspaceVersionId: string;
    usedSegmentConfig: cliConfig.ContextSegment;
    activeSegments: api.WorkspaceSegmentId[];
    view: vscode.TreeView<TimelineTreeItemData>;
    workspaceState?: TimelinesTreeMemento;

    private _onDidChangeTreeData: vscode.EventEmitter<TimelineTreeItemData | TimelineTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<TimelineTreeItemData | TimelineTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    constructor(private readonly apiClient: api.Client) {}

    register(context: vscode.ExtensionContext) {
        this.workspaceState = new TimelinesTreeMemento(context.workspaceState);
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
            vscode.commands.registerCommand("auxon.timelines.setGroupingAttrs", () => this.setGroupingAttrs()),
            vscode.commands.registerCommand("auxon.timelines.groupTimelinesByNameComponents", () =>
                this.groupTimelinesByNameComponents()
            )
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TimelineTreeItemData): vscode.TreeItem {
        return element.treeItem();
    }

    async getChildren(element?: TimelineTreeItemData): Promise<TimelineTreeItemData[]> {
        // This is an 'uninitialized' condition
        if (!this.usedSegmentConfig) {
            return [];
        }

        if (element) {
            return element.children();
        }

        // root element
        const groupingAttrKeys = this.workspaceState.getGroupingAttrKeys();
        const groupByTimelineNameComponents = this.workspaceState.getGroupByTimelineNameComponents();
        if (groupingAttrKeys.length > 0) {
            let groups: api.TimelineGroup[] = [];
            switch (this.usedSegmentConfig.type) {
                case "All":
                case "WholeWorkspace":
                    if (!this.activeWorkspaceVersionId) {
                        return [];
                    }
                    groups = await this.apiClient
                        .workspace(this.activeWorkspaceVersionId)
                        .groupedTimelines(groupingAttrKeys);
                    break;

                case "Latest":
                case "Set":
                    if (this.activeSegments) {
                        for (const segmentId of this.activeSegments) {
                            const api_groups = await this.apiClient
                                .segment(segmentId)
                                .groupedTimelines(groupingAttrKeys);
                            for (const tl_group of api_groups) {
                                groups.push(tl_group);
                            }
                        }
                    }
                    break;
            }

            return groups.map((tl_group) => new TimelineGroupTreeItemData(tl_group));
        } else {
            // Not grouping by attr keys; just get the timelines
            let timelines: api.TimelineOverview[] = [];
            switch (this.usedSegmentConfig.type) {
                case "All":
                case "WholeWorkspace":
                    if (!this.activeWorkspaceVersionId) {
                        return [];
                    }
                    timelines = await this.apiClient.workspace(this.activeWorkspaceVersionId).timelines();
                    break;

                case "Latest":
                case "Set":
                    if (this.activeSegments) {
                        for (const segmentId of this.activeSegments) {
                            for (const timeline of await this.apiClient.segment(segmentId).timelines()) {
                                timelines.push(timeline);
                            }
                        }
                    }
                    break;
            }
            timelines.sort((a, b) => a.name.localeCompare(b.name));

            if (groupByTimelineNameComponents) {
                const root = new TimelineGroupByNameTreeItemData("", []);
                for (const timeline of timelines) {
                    let timelineNamePath = [];
                    if (timeline.name) {
                        timelineNamePath = timeline.name.split(".");
                    }
                    root.insertNode(timeline, timelineNamePath);
                }
                root.updateDescriptions();
                return root.children();
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

    groupTimelinesByNameComponents() {
        this.workspaceState.setGroupingAttrKeys([]);
        this.workspaceState.setGroupByTimelineNameComponents(true);
        this.refresh();
    }

    async setGroupingAttrs() {
        const tlAttrs = await this.getAvailableTimelineAttrKeys();
        const groupingAttrKeys = this.workspaceState.getGroupingAttrKeys();
        const pickItems: vscode.QuickPickItem[] = tlAttrs.map((tlAttr) => {
            const picked = groupingAttrKeys.find((el) => el == tlAttr) !== undefined;
            const label = tlAttr;
            return { label, picked };
        });

        const pickedItems = await vscode.window.showQuickPick(pickItems, { canPickMany: true });
        this.workspaceState.setGroupingAttrKeys(pickedItems.map((pi) => pi.label).sort());
        this.refresh();
    }

    async getAvailableTimelineAttrKeys(): Promise<string[]> {
        switch (this.usedSegmentConfig.type) {
            case "All":
            case "WholeWorkspace":
                if (!this.activeWorkspaceVersionId) {
                    return [];
                }
                return await this.apiClient.workspace(this.activeWorkspaceVersionId).timelineAttrKeys();

            case "Latest":
            case "Set":
                if (!this.activeSegments) {
                    return [];
                } else {
                    const keys = new Set<string>();
                    for (const segmentId of this.activeSegments) {
                        for (const key of await this.apiClient.segment(segmentId).timelineAttrKeys()) {
                            keys.add(key);
                        }
                    }

                    return [...keys];
                }
        }
    }
}

// This is the base of all the tree item data classes
abstract class TimelineTreeItemData {
    abstract name: string;
    abstract contextValue: string;
    timelineId?: api.TimelineId = undefined;
    description?: string = undefined;
    tooltip?: vscode.MarkdownString = undefined;
    iconPath?: vscode.ThemeIcon = undefined;

    treeItem(): vscode.TreeItem {
        let state = vscode.TreeItemCollapsibleState.Collapsed;
        if (this.children().length == 0) {
            state = vscode.TreeItemCollapsibleState.None;
        }

        const item = new vscode.TreeItem(this.name, state);
        item.contextValue = this.contextValue;
        item.description = this.description;
        item.tooltip = this.tooltip;
        item.iconPath = this.iconPath;

        // Timeline selection updates the events summary view
        if (this.contextValue == "timeline") {
            const command = {
                title: "Update events summary for the selected timeline",
                command: "auxon.events.setSelectedTimelineId",
                arguments: [this.timelineId],
            };
            item.command = command;
        }

        return item;
    }

    children(): TimelineTreeItemData[] {
        return [];
    }

    postwalk(f: (n: TimelineTreeItemData) => void) {
        for (const child of this.children()) {
            child.postwalk(f);
        }
        f(this);
    }

    getTimelineIds(): api.TimelineId[] {
        const ids = [];
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
            if (n.children().length > 0) {
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
    constructor(public name: string, private childItems: TimelineTreeItemData[]) {
        super();
    }

    contextValue = "timelineGroup";

    override children(): TimelineTreeItemData[] {
        return this.childItems;
    }

    insertNode(timeline: api.TimelineOverview, timelineNamePath: string[]) {
        if (timelineNamePath.length == 0) {
            this.childItems.push(new TimelineLeafTreeItemData(timeline));
        } else {
            const nextNodeName = timelineNamePath.shift();

            let nextNodeIndex = this.childItems.findIndex((item) => item.name == nextNodeName);
            if (nextNodeIndex == -1) {
                this.childItems.push(new TimelineGroupByNameTreeItemData(nextNodeName, []));
                nextNodeIndex = this.childItems.length - 1;
            }

            let nextNode = this.childItems[nextNodeIndex];
            if (!(nextNode instanceof TimelineGroupByNameTreeItemData)) {
                // Some non-namegroup node is there, with the same name. Replace it with a namegroup,
                // and insert the old node as a child.
                const newNode = new TimelineGroupByNameTreeItemData(nextNodeName, [nextNode]);
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

    override children(): TimelineTreeItemData[] {
        const timelines = this.timeline_group.timelines.sort();
        return timelines.map((timeline_overview) => new TimelineLeafTreeItemData(timeline_overview));
    }
}

export class TimelineLeafTreeItemData extends TimelineTreeItemData {
    name = "";
    contextValue = "timeline";
    iconPath = new vscode.ThemeIcon("git-commit");

    constructor(public timeline_overview: api.TimelineOverview) {
        super();

        this.timelineId = this.timeline_overview.id;
        let label = this.timeline_overview.name;
        if (label === null) {
            label = "<unnamed>";
        }
        this.name = label;
        this.description = this.timeline_overview.id;

        let tooltip = `- **Timeline Name**: ${this.timeline_overview.name}`;
        tooltip += `\n- **Timeline Id**: ${this.timeline_overview.id}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }
}
