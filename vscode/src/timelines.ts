/**
 * TreeDataProvider for the timeline list , in the left side panel.
 */

import * as api from './modalityApi';
import * as vscode from 'vscode';
import * as cliConfig from './cliConfig';
import * as modalityLog from './modalityLog';
import * as transitionGraph from './transitionGraph';

export class TimelinesTreeDataProvider implements vscode.TreeDataProvider<TimelineTreeItemData> {
    activeWorkspaceVersionId: string;
    usedSegmentConfig: cliConfig.ContextSegment;
    activeSegments: api.WorkspaceSegmentId[];
    view: vscode.TreeView<TimelineTreeItemData>;

    private _onDidChangeTreeData: vscode.EventEmitter<TimelineTreeItemData | TimelineTreeItemData[] | undefined> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<TimelineTreeItemData | TimelineTreeItemData[] | undefined> = this._onDidChangeTreeData.event;

    constructor(private readonly apiClient: api.Client) { }

    register(context: vscode.ExtensionContext) {
        this.view = vscode.window.createTreeView("auxon.timelines", { treeDataProvider: this, canSelectMany: true });

        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.timelines.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.timelines.inspect", (itemData) => this.inspectTimelineCommand(itemData)),
            vscode.commands.registerCommand("auxon.timelines.logSelected", () => this.logSelectedCommand()),
            vscode.commands.registerCommand("auxon.timelines.transitionGraph", (itemData) => this.transitionGraph(itemData)),
            vscode.commands.registerCommand("auxon.timelines.transitionGraphForSelection", () => this.transitionGraphForSelection())
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TimelineTreeItemData): TimelineTreeItem {
        return new TimelineTreeItem(element);
    }

    async getChildren(element?: TimelineTreeItemData): Promise<TimelineTreeItemData []> {
        if (element) { return []; }
        if (!this.usedSegmentConfig) { return []; }

        var timelines: api.TimelineOverview[] = [];
        switch (this.usedSegmentConfig.type) {
            case "All":
            case "WholeWorkspace":
                if (!this.activeWorkspaceVersionId) { return []; }
                timelines = await this.apiClient.workspace(this.activeWorkspaceVersionId).timelines();
                break;

            case "Latest":
            case "Set":
                if (!this.activeSegments) { return []; }
                for (const segmentId of this.activeSegments) {
                    for (var timeline of await this.apiClient.segment(segmentId).timelines()) {
                        timelines.push(timeline);
                    }
                }
                break;
        }

        return timelines.map((timeline_overview) => new TimelineTreeItemData(timeline_overview));
    }

    async inspectTimelineCommand(item: TimelineTreeItemData) {
        let timeline = await this.apiClient.timeline(item.timeline_overview.id).get();
        let timelineJson = JSON.stringify(timeline, null, 4);

        const doc = await vscode.workspace.openTextDocument({ language: "json", content: timelineJson });
        await vscode.window.showTextDocument(doc);
    }

    logSelectedCommand() {
        const thingToLog = this.view.selection.map((item) => item.timeline_overview.id);

        vscode.commands.executeCommand(
            modalityLog.MODALITY_LOG_COMMAND,
            new modalityLog.ModalityLogCommandArgs({ thingToLog })
        );
    }

    transitionGraph(item: TimelineTreeItemData) {
        transitionGraph.promptForGraphGrouping((groupBy) => {
            transitionGraph.showGraphForTimelines([item.timeline_overview.id], groupBy);
        });
    }

    transitionGraphForSelection() {
        const timelineIds = this.view.selection.map((item) => item.timeline_overview.id);
        transitionGraph.promptForGraphGrouping((groupBy) => {
            transitionGraph.showGraphForTimelines(timelineIds, groupBy);
        });

    }
}

export class TimelineTreeItemData {
    constructor(public timeline_overview: api.TimelineOverview) { }
}

class TimelineTreeItem extends vscode.TreeItem {
    contextValue = 'timeline';

    constructor(public readonly data: TimelineTreeItemData) {
        const label = data.timeline_overview.name;
        super(label, vscode.TreeItemCollapsibleState.None);

        this.description = data.timeline_overview.id;

        let tooltip = `- **Timeline Name**: ${data.timeline_overview.name}`;
        tooltip += `\n- **Timeline Id**: ${data.timeline_overview.id}`;
        this.tooltip = new vscode.MarkdownString(tooltip);

        this.iconPath = new vscode.ThemeIcon("git-commit");
    }
}


