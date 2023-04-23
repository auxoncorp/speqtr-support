import * as vscode from 'vscode';
import * as util from 'util';
import { isDeepStrictEqual } from 'util';
import * as child_process from 'child_process';

import * as api from './modalityApi';
import * as cliConfig from './cliConfig';
import * as config from './config';
import * as transitionGraph from './transitionGraph';

const execFile = util.promisify(child_process.execFile);

export class SegmentsTreeDataProvider implements vscode.TreeDataProvider<SegmentTreeItemData> {
    activeWorkspaceVersionId: string;
    usedSegmentConfig: cliConfig.ContextSegment;
    activeSegmentIds: api.WorkspaceSegmentId[];
    view: vscode.TreeView<SegmentTreeItemData>;

    private _onDidChangeTreeData: vscode.EventEmitter<SegmentTreeItemData | SegmentTreeItemData[] | undefined> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SegmentTreeItemData | SegmentTreeItemData[] | undefined> = this._onDidChangeTreeData.event;

    private _onDidChangeUsedSegments: vscode.EventEmitter<UsedSegmentsChangeEvent> = new vscode.EventEmitter();
    readonly onDidChangeUsedSegments: vscode.Event<UsedSegmentsChangeEvent> = this._onDidChangeUsedSegments.event;

    constructor(private readonly apiClient: api.Client) { }

    register(context: vscode.ExtensionContext) {
        this.view = vscode.window.createTreeView("auxon.segments", { treeDataProvider: this, canSelectMany: true });

        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.segments.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.segments.setActive", (itemData) => this.setActiveCommand(itemData)),
            vscode.commands.registerCommand("auxon.segments.setActiveFromSelection", () => this.setActiveFromSelectionCommand()),
            vscode.commands.registerCommand("auxon.segments.setLatestActive", () => this.setLatestActiveCommand()),
            vscode.commands.registerCommand("auxon.segments.setAllActive", () => this.setAllActiveCommand()),
            vscode.commands.registerCommand("auxon.segments.setWholeWorkspaceActive", () => this.setWholeWorkspaceActiveCommand()),
            vscode.commands.registerCommand("auxon.segments.transitionGraph", (itemData) => this.transitionGraph(itemData)),
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SegmentTreeItemData): SegmentTreeItem {
        return new SegmentTreeItem(element);
    }

    async getChildren(element?: SegmentTreeItemData): Promise<SegmentTreeItemData []> {
        if (element) { return; }
        if (!this.activeWorkspaceVersionId) { return; }

        const usedSegmentConfig = await cliConfig.usedSegments();

        var activeSegmentIds: api.WorkspaceSegmentId[];
        if (usedSegmentConfig.type == "Latest" || usedSegmentConfig.type == "Set") {
            activeSegmentIds = (await cliConfig.activeSegments()).map((meta) => meta.id);
        }

        let workspaceSegments = await this.apiClient.workspace(this.activeWorkspaceVersionId).segments();

        var items = [];
        for (const segment of workspaceSegments) {
            var isActive = false;
            switch (usedSegmentConfig.type) {
                case "All":
                    isActive = true;
                    break;
                    
                case "WholeWorkspace":
                    break;

                case "Latest":
                case "Set":
                    isActive = activeSegmentIds.some(
                        (active_seg_id) => isDeepStrictEqual(active_seg_id, segment.id)
                    );
                    break;
            }

            items.push(new SegmentTreeItemData(segment, isActive));
        }

        if (!isDeepStrictEqual(usedSegmentConfig, this.usedSegmentConfig) || !isDeepStrictEqual(activeSegmentIds, this.activeSegmentIds)) {
            this.usedSegmentConfig = usedSegmentConfig;
            this.activeSegmentIds = activeSegmentIds;
            this._onDidChangeUsedSegments.fire( new UsedSegmentsChangeEvent(this.usedSegmentConfig, this.activeSegmentIds)  );
        }

        if (usedSegmentConfig.type == "WholeWorkspace") {
            this.view.message = "The whole workspace is currently active as a single universe, without any segmentation applied.";
            return [];
        } else {
            this.view.message = null;
            return items;
        }
    }

    async setActiveCommand(item: SegmentTreeItemData) {
        let modality = config.toolPath("modality");
        let args = ['segment', 'use', '--segmentation-rule', item.segment.id.rule_name, item.segment.id.segment_name];
        await execFile(modality, args);
        this.refresh();
    }

    async setActiveFromSelectionCommand() {
        var args = ['segment', 'use'];
        var ruleName: string;
        for (const item of this.view.selection) {
            if (!ruleName) {
                ruleName = item.segment.id.rule_name;
                args.push('--segmentation-rule', item.segment.id.rule_name);
            } else if (item.segment.id.rule_name != ruleName) {
                // TODO can we make this possible? Might just be a cli limitation.
                throw new Error("Segments from different segmentation rules cannot be used together.");
            }
            
            args.push(item.segment.id.segment_name);
        }

        await execFile(config.toolPath("modality"), args);
        this.refresh();
    }

    async setLatestActiveCommand() {
        await execFile(config.toolPath("modality"), ['segment', 'use', '--latest']);
        this.refresh();
    }

    async setAllActiveCommand() {
        await execFile(config.toolPath("modality"), ['segment', 'use', '--all-segments']);
        this.refresh();
    }

    async setWholeWorkspaceActiveCommand() {
        await execFile(config.toolPath("modality"), ['segment', 'use', '--whole-workspace']);
        this.refresh();
    }

    transitionGraph(item: SegmentTreeItemData) {
        transitionGraph.promptForGraphGrouping((groupBy) => {
            transitionGraph.showGraphForSegment(item.segment.id, groupBy);
        });
    }
}


export class UsedSegmentsChangeEvent {
    constructor(
        public usedSegmentConfig: cliConfig.ContextSegment,
        public activeSegmentIds: api.WorkspaceSegmentId[],
    ) { }
}

const ACTIVE_ITEM_MARKER = "✦";

export class SegmentTreeItemData {
    constructor(
        public segment: api.WorkspaceSegmentMetadata,
        public isActive: boolean
    ) { }
}

class SegmentTreeItem extends vscode.TreeItem {
    contextValue = 'segment';

    constructor(public readonly data: SegmentTreeItemData) {
        const label = `${data.segment.id.segment_name}`
        super(label, vscode.TreeItemCollapsibleState.None);

        // js date is millis since the epoch; we have nanos.
        let segDate = new Date(data.segment.latest_receive_time / 1_000_000);
        this.description = segDate.toLocaleString();

        let tooltip = `- **Segment Name**: ${data.segment.id.segment_name}`;
        tooltip += `\n- **Segmentation Rule Name**: ${data.segment.id.rule_name}`;
        if (data.isActive) {
            tooltip += `\n- **${ACTIVE_ITEM_MARKER}** This is the currently active segment.`;
        }
        this.tooltip = new vscode.MarkdownString(tooltip);

        if (data.isActive) {
            this.iconPath = new vscode.ThemeIcon("pass", new vscode.ThemeColor("debugIcon.startForeground"));
        } else {
            this.iconPath = new vscode.ThemeIcon("git-compare");
        }
    }
}
