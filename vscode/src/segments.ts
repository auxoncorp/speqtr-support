import * as vscode from "vscode";

import * as api from "./modalityApi";
import * as specCoverage from "./specCoverage";
import * as transitionGraph from "./transitionGraph";
import * as workspaceState from "./workspaceState";
import { ModalityLogCommandArgs } from "./modalityLog";
import { SegmentId } from "common-src/experimentWebViewApi";

export class SegmentsTreeDataProvider implements vscode.TreeDataProvider<SegmentTreeItemData> {
    modalityView: vscode.TreeView<SegmentTreeItemData>;
    conformView: vscode.TreeView<SegmentTreeItemData>;
    deviantView: vscode.TreeView<SegmentTreeItemData>;
    activeView: vscode.TreeView<SegmentTreeItemData>;

    private _onDidChangeTreeData: vscode.EventEmitter<SegmentTreeItemData | SegmentTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SegmentTreeItemData | SegmentTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    constructor(
        private readonly apiClient: api.Client,
        private readonly cov: specCoverage.SpecCoverageProvider,
        private wss: workspaceState.WorkspaceAndSegmentState,
        context: vscode.ExtensionContext
    ) {
        this.modalityView = vscode.window.createTreeView("auxon.modality_segments", {
            treeDataProvider: this,
            canSelectMany: true,
        });
        const modalityViewListener = this.modalityView.onDidChangeVisibility(async (ev) => {
            if (ev.visible) {
                this.activeView = this.modalityView;
            }
        });

        this.conformView = vscode.window.createTreeView("auxon.conform_segments", {
            treeDataProvider: this,
            canSelectMany: true,
        });
        const conformViewListener = this.conformView.onDidChangeVisibility(async (ev) => {
            if (ev.visible) {
                this.activeView = this.conformView;
            }
        });

        this.deviantView = vscode.window.createTreeView("auxon.deviant_segments", {
            treeDataProvider: this,
            canSelectMany: true,
        });
        const deviantViewListener = this.deviantView.onDidChangeVisibility(async (ev) => {
            if (ev.visible) {
                this.activeView = this.deviantView;
            }
        });

        // Default to the modality view
        this.activeView = this.modalityView;

        context.subscriptions.push(
            this.modalityView,
            modalityViewListener,
            this.conformView,
            conformViewListener,
            this.deviantView,
            deviantViewListener,
            vscode.commands.registerCommand("auxon.segments.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.segments.setActive", (itemData) => this.setActiveCommand(itemData)),
            vscode.commands.registerCommand("auxon.segments.setActiveFromSelection", () =>
                this.setActiveFromSelectionCommand()
            ),
            vscode.commands.registerCommand("auxon.segments.setLatestActive", () => this.setLatestActiveCommand()),
            vscode.commands.registerCommand("auxon.segments.setAllActive", () => this.setAllActiveCommand()),
            vscode.commands.registerCommand("auxon.segments.setWholeWorkspaceActive", () =>
                this.setWholeWorkspaceActiveCommand()
            ),
            vscode.commands.registerCommand("auxon.segments.specCoverage", (itemData) =>
                this.showSpecCoverageForSegment(itemData)
            ),
            vscode.commands.registerCommand("auxon.segments.transitionGraph", (itemData) =>
                this.transitionGraph(itemData)
            ),
            wss.onDidChangeUsedSegments(() => this.refresh())
        );
    }

    refresh(): void {
        this.wss.refresh();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SegmentTreeItemData): vscode.TreeItem {
        return element.treeItem();
    }

    async getChildren(element?: SegmentTreeItemData): Promise<SegmentTreeItemData[]> {
        const children = await this.getChildrenInner(element);
        if (children.length === 0) {
            this.activeView.message =
                "The active workspace contains no segments. Record some data using one of our provided reflector plugins or the Auxon SDK.";
        } else {
            this.activeView.message = undefined;
        }
        return children;
    }

    private async getChildrenInner(element?: SegmentTreeItemData): Promise<SegmentTreeItemData[]> {
        if (element) {
            return element.childItems;
        }

        const workspaceSegments = await this.apiClient.workspace(this.wss.activeWorkspaceVersionId).segments();
        workspaceSegments.sort((a, b) => {
            if (a.latest_receive_time == null) {
                return 1;
            }
            if (b.latest_receive_time == null) {
                return -1;
            }
            return a.latest_receive_time - b.latest_receive_time;
        });

        const root = new GroupSegmentTreeItemData("<root>");
        for (const segment of workspaceSegments) {
            const namePath = segment.id.segment_name.split("/");
            let currentItem = root;
            for (;;) {
                const nodeName = namePath.shift();
                if (!nodeName) {
                    break;
                }

                if (namePath.length == 0) {
                    currentItem.childItems.push(
                        new LeafSegmentTreeItemData(nodeName, segment, this.wss.isSegmentActive(segment.id))
                    );
                    break;
                }

                let newItem = currentItem.childItems.find((i) => i.name == nodeName);
                if (!newItem) {
                    newItem = new GroupSegmentTreeItemData(nodeName);
                    currentItem.childItems.push(newItem);
                }

                currentItem = newItem;
            }
        }

        if (this.wss.isWholeWorkspaceActive()) {
            this.activeView.message =
                "The whole workspace is currently active as a single universe, without any segmentation applied.";
            return [];
        } else {
            this.activeView.message = undefined;
            return root.childItems;
        }
    }

    async setActiveCommand(item: LeafSegmentTreeItemData) {
        await this.wss.setActiveSegments([item.segment.id]);
    }

    async setActiveFromSelectionCommand() {
        const segmentIds = this.activeView.selection.map((item) => item.segmentId()).filter((id) => id != null);
        if (segmentIds != null) {
            this.wss.setActiveSegments(segmentIds);
        }
    }

    async setLatestActiveCommand() {
        await this.wss.useLatestSegment();
    }

    async setAllActiveCommand() {
        await this.wss.setAllActiveSegments();
    }

    async setWholeWorkspaceActiveCommand() {
        await this.wss.setWholeWorkspaceActive();
    }

    async showSpecCoverageForSegment(item: LeafSegmentTreeItemData) {
        await this.cov.showSpecCoverage({ segmentId: item.segment.id });
    }

    transitionGraph(item: LeafSegmentTreeItemData) {
        transitionGraph.promptForGraphGrouping((groupBy, groupByTimelineComponent) => {
            transitionGraph.showGraphForSegment(
                item.segment.id,
                groupBy,
                groupByTimelineComponent,
                this.wss.activeWorkspaceVersionId
            );
        });
    }
}

abstract class SegmentTreeItemData {
    abstract name: string;
    abstract contextValue: string;
    childItems: SegmentTreeItemData[] = [];
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

    segmentId(): SegmentId | null {
        return null;
    }

    abstract segmentCount(): number;

    // async children(_apiClient: api.Client): Promise<SegmentTreeItemData[]> {
    //     return [];
    // }
}

const ACTIVE_ITEM_MARKER = "✦";

export class LeafSegmentTreeItemData extends SegmentTreeItemData {
    contextValue = "segment";

    constructor(public name: string, public segment: api.WorkspaceSegmentMetadata, public isActive: boolean) {
        super();

        // js date is millis since the epoch; we have nanos.
        if (segment.latest_receive_time != null) {
            const segDate = new Date(segment.latest_receive_time / 1_000_000);
            this.description = segDate.toLocaleString();
        }

        let tooltip = `- **Segment Name**: ${segment.id.segment_name}`;
        tooltip += `\n- **Segmentation Rule Name**: ${segment.id.rule_name}`;
        if (isActive) {
            tooltip += `\n- **${ACTIVE_ITEM_MARKER}** This is the currently active segment.`;
        }
        this.tooltip = new vscode.MarkdownString(tooltip);

        if (isActive) {
            this.iconPath = new vscode.ThemeIcon("pass", new vscode.ThemeColor("debugIcon.startForeground"));
        } else {
            this.iconPath = new vscode.ThemeIcon("git-compare");
        }
    }

    segmentId(): SegmentId | null {
        return this.segment.id;
    }

    getModalityLogCommandArgs(): ModalityLogCommandArgs {
        return new ModalityLogCommandArgs({
            segmentationRule: this.segment.id.rule_name,
            segment: this.segment.id.segment_name,
        });
    }

    segmentCount(): number {
        return 1;
    }
}

export class GroupSegmentTreeItemData extends SegmentTreeItemData {
    contextValue = "segment_group";

    constructor(public name: string) {
        super();
    }

    canHaveChildren(): boolean {
        return true;
    }

    treeItem(): vscode.TreeItem {
        const count = this.segmentCount();
        if (count == 1) {
            this.description = "1 segment";
        } else {
            this.description = `${count} segments`;
        }
        return super.treeItem();
    }

    segmentCount(): number {
        return this.childItems.map((i) => i.segmentCount()).reduce((a, b) => a + b);
    }
}
