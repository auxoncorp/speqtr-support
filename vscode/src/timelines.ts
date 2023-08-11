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
            vscode.commands.registerCommand("auxon.timelines.setGroupingAttrs", () => this.setGroupingAttrs())
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
            if (element instanceof TimelineGroupTreeItemData) {
                const timelines = element.timeline_group.timelines.sort();
                return timelines.map((timeline_overview) => new TimelineLeafTreeItemData(timeline_overview));
            } else if (element instanceof TimelineLeafTreeItemData) {
                return [];
            }
        }

        // root element
        const groupingAttrKeys = this.workspaceState.getGroupingAttrKeys();
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
            // no grouping
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

            return timelines.map((timeline_overview) => new TimelineLeafTreeItemData(timeline_overview));
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
        let timelineIds = this.view.selection.flatMap((data) => data.getTimelinesIds());
        timelineIds = [...new Set(timelineIds)]; // dedupe

        vscode.commands.executeCommand(
            modalityLog.MODALITY_LOG_COMMAND,
            new modalityLog.ModalityLogCommandArgs({ thingToLog: timelineIds })
        );
    }

    transitionGraph(item: TimelineTreeItemData) {
        transitionGraph.promptForGraphGrouping((groupBy) => {
            transitionGraph.showGraphForTimelines(item.getTimelinesIds(), groupBy);
        });
    }

    transitionGraphForSelection() {
        let timelineIds = this.view.selection.flatMap((data) => data.getTimelinesIds());
        timelineIds = [...new Set(timelineIds)]; // dedupe

        transitionGraph.promptForGraphGrouping((groupBy) => {
            transitionGraph.showGraphForTimelines(timelineIds, groupBy);
        });
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

type TimelineTreeItemData = TimelineGroupTreeItemData | TimelineLeafTreeItemData;

export class TimelineGroupTreeItemData {
    constructor(public timeline_group: api.TimelineGroup) {}

    treeItem(): vscode.TreeItem {
        return new TimelineGroupTreeItem(this);
    }

    getTimelinesIds(): api.TimelineId[] {
        return this.timeline_group.timelines.map((tl) => tl.id);
    }

    getModalityLogCommandArgs(): modalityLog.ModalityLogCommandArgs {
        return new modalityLog.ModalityLogCommandArgs({
            thingToLog: this.timeline_group.timelines.map((tl) => tl.id),
        });
    }
}

class TimelineGroupTreeItem extends vscode.TreeItem {
    contextValue = "timelineGroup";
    constructor(public readonly data: TimelineGroupTreeItemData) {
        let name = null;
        for (const val of Object.values(data.timeline_group.group_attributes)) {
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

        super(name, vscode.TreeItemCollapsibleState.Collapsed);
    }
}

export class TimelineLeafTreeItemData {
    constructor(public timeline_overview: api.TimelineOverview) {}

    treeItem(): vscode.TreeItem {
        return new TimelineLeafTreeItem(this);
    }

    getTimelinesIds(): api.TimelineId[] {
        return [this.timeline_overview.id];
    }

    getModalityLogCommandArgs(): modalityLog.ModalityLogCommandArgs {
        return new modalityLog.ModalityLogCommandArgs({
            thingToLog: this.timeline_overview.id,
        });
    }
}

class TimelineLeafTreeItem extends vscode.TreeItem {
    contextValue = "timeline";
    constructor(public readonly data: TimelineLeafTreeItemData) {
        let label = data.timeline_overview.name;
        if (label === null) {
            label = "<unnamed>";
        }
        super(label, vscode.TreeItemCollapsibleState.None);

        this.description = data.timeline_overview.id;

        let tooltip = `- **Timeline Name**: ${data.timeline_overview.name}`;
        tooltip += `\n- **Timeline Id**: ${data.timeline_overview.id}`;
        this.tooltip = new vscode.MarkdownString(tooltip);

        this.iconPath = new vscode.ThemeIcon("git-commit");
    }
}
