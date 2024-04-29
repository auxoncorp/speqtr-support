import * as vscode from "vscode";

import * as api from "./modalityApi";
import * as specCoverage from "./specCoverage";
import * as transitionGraph from "./transitionGraph";
import * as workspaceState from "./workspaceState";
import { ModalityLogCommandArgs } from "./modalityLog";

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

    getTreeItem(element: SegmentTreeItemData): SegmentTreeItem {
        return new SegmentTreeItem(element);
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
        // only the root has children
        if (element != null) {
            return [];
        }

        const workspaceSegments = await this.apiClient.workspace(this.wss.activeWorkspaceVersionId).segments();

        const items = [];
        for (const segment of workspaceSegments) {
            items.push(new SegmentTreeItemData(segment, this.wss.isSegmentActive(segment.id)));
        }

        items.sort((a, b) => {
            if (a?.segment?.latest_receive_time == null) {
                return 1;
            }
            if (b?.segment?.latest_receive_time == null) {
                return -1;
            }
            return a.segment.latest_receive_time - b.segment.latest_receive_time;
        });

        if (this.wss.isWholeWorkspaceActive()) {
            this.activeView.message =
                "The whole workspace is currently active as a single universe, without any segmentation applied.";
            return [];
        } else {
            this.activeView.message = undefined;
            return items;
        }
    }

    async setActiveCommand(item: SegmentTreeItemData) {
        await this.wss.setActiveSegments([item.segment.id]);
    }

    async setActiveFromSelectionCommand() {
        const segmentIds = this.activeView.selection.map((item) => item.segment.id);
        this.wss.setActiveSegments(segmentIds);
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

    async showSpecCoverageForSegment(item: SegmentTreeItemData) {
        await this.cov.showSpecCoverage({ segmentId: item.segment.id });
    }

    transitionGraph(item: SegmentTreeItemData) {
        transitionGraph.promptForGraphGrouping((groupBy) => {
            transitionGraph.showGraphForSegment(item.segment.id, groupBy);
        });
    }
}

const ACTIVE_ITEM_MARKER = "✦";

export class SegmentTreeItemData {
    constructor(public segment: api.WorkspaceSegmentMetadata, public isActive: boolean) {}

    getModalityLogCommandArgs(): ModalityLogCommandArgs {
        return new ModalityLogCommandArgs({
            segmentationRule: this.segment.id.rule_name,
            segment: this.segment.id.segment_name,
        });
    }
}

class SegmentTreeItem extends vscode.TreeItem {
    contextValue = "segment";

    constructor(public readonly data: SegmentTreeItemData) {
        const label = `${data.segment.id.segment_name}`;
        super(label, vscode.TreeItemCollapsibleState.None);

        // js date is millis since the epoch; we have nanos.
        if (data?.segment?.latest_receive_time != null) {
            const segDate = new Date(data.segment.latest_receive_time / 1_000_000);
            this.description = segDate.toLocaleString();
        }

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
