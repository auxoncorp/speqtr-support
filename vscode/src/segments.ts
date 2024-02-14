import * as vscode from "vscode";
import * as util from "util";
import { isDeepStrictEqual } from "util";
import * as child_process from "child_process";

import * as api from "./modalityApi";
import * as cliConfig from "./cliConfig";
import * as config from "./config";
import * as specCoverage from "./specCoverage";
import * as transitionGraph from "./transitionGraph";
import { ModalityLogCommandArgs } from "./modalityLog";

const execFile = util.promisify(child_process.execFile);

export class SegmentsTreeDataProvider implements vscode.TreeDataProvider<SegmentTreeItemData> {
    activeWorkspaceVersionId: string;
    usedSegmentConfig: cliConfig.ContextSegment;
    activeSegmentIds: api.WorkspaceSegmentId[];
    modalityView: vscode.TreeView<SegmentTreeItemData>;
    conformView: vscode.TreeView<SegmentTreeItemData>;
    deviantView: vscode.TreeView<SegmentTreeItemData>;
    activeView: vscode.TreeView<SegmentTreeItemData>;

    private _onDidChangeTreeData: vscode.EventEmitter<SegmentTreeItemData | SegmentTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SegmentTreeItemData | SegmentTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    private _onDidChangeUsedSegments: vscode.EventEmitter<UsedSegmentsChangeEvent> = new vscode.EventEmitter();
    readonly onDidChangeUsedSegments: vscode.Event<UsedSegmentsChangeEvent> = this._onDidChangeUsedSegments.event;

    constructor(private readonly apiClient: api.Client, private readonly cov: specCoverage.SpecCoverageProvider) {}

    register(context: vscode.ExtensionContext) {
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
            )
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SegmentTreeItemData): SegmentTreeItem {
        return new SegmentTreeItem(element);
    }

    async getChildren(element?: SegmentTreeItemData): Promise<SegmentTreeItemData[]> {
        if (element) {
            return;
        }
        if (!this.activeWorkspaceVersionId) {
            return;
        }

        const usedSegmentConfig = await cliConfig.usedSegments();

        let activeSegmentIds: api.WorkspaceSegmentId[];
        if (usedSegmentConfig.type == "Latest" || usedSegmentConfig.type == "Set") {
            activeSegmentIds = (await cliConfig.activeSegments()).map((meta) => meta.id);
        }

        const workspaceSegments = await this.apiClient.workspace(this.activeWorkspaceVersionId).segments();

        const items = [];
        for (const segment of workspaceSegments) {
            let isActive = false;
            switch (usedSegmentConfig.type) {
                case "All":
                    isActive = true;
                    break;

                case "WholeWorkspace":
                    break;

                case "Latest":
                case "Set":
                    isActive = activeSegmentIds.some((active_seg_id) => isDeepStrictEqual(active_seg_id, segment.id));
                    break;
            }

            items.push(new SegmentTreeItemData(segment, isActive));
        }

        items.sort((a, b) => {
            if (a === null || a.name === null) {
                return 1;
            }
            if (b === null || b.name === null) {
                return -1;
            }
            return a.segment.latest_receive_time - b.segment.latest_receive_time;
        });

        if (
            !isDeepStrictEqual(usedSegmentConfig, this.usedSegmentConfig) ||
            !isDeepStrictEqual(activeSegmentIds, this.activeSegmentIds)
        ) {
            this.usedSegmentConfig = usedSegmentConfig;
            this.activeSegmentIds = activeSegmentIds;
            this._onDidChangeUsedSegments.fire(
                new UsedSegmentsChangeEvent(this.usedSegmentConfig, this.activeSegmentIds)
            );
        }

        if (usedSegmentConfig.type == "WholeWorkspace") {
            this.activeView.message =
                "The whole workspace is currently active as a single universe, without any segmentation applied.";
            return [];
        } else {
            this.activeView.message = null;
            return items;
        }
    }

    async setActiveCommand(item: SegmentTreeItemData) {
        const modality = config.toolPath("modality");
        const args = [
            "segment",
            "use",
            "--segmentation-rule",
            item.segment.id.rule_name,
            item.segment.id.segment_name,
            ...config.extraCliArgs("modality segment use"),
        ];
        await execFile(modality, args);
        this.refresh();
    }

    async setActiveFromSelectionCommand() {
        const args = ["segment", "use"];
        let ruleName: string;
        for (const item of this.activeView.selection) {
            if (!ruleName) {
                ruleName = item.segment.id.rule_name;
                args.push("--segmentation-rule", item.segment.id.rule_name);
            } else if (item.segment.id.rule_name != ruleName) {
                // TODO can we make this possible? Might just be a cli limitation.
                throw new Error("Segments from different segmentation rules cannot be used together.");
            }

            args.push(item.segment.id.segment_name);
        }

        for (const extra of config.extraCliArgs("modality segment use")) {
            args.push(extra);
        }

        await execFile(config.toolPath("modality"), args);
        this.refresh();
    }

    async setLatestActiveCommand() {
        await execFile(config.toolPath("modality"), [
            "segment",
            "use",
            "--latest",
            ...config.extraCliArgs("modality segment use"),
        ]);
        this.refresh();
    }

    async setAllActiveCommand() {
        await execFile(config.toolPath("modality"), [
            "segment",
            "use",
            "--all-segments",
            ...config.extraCliArgs("modality segment use"),
        ]);
        this.refresh();
    }

    async setWholeWorkspaceActiveCommand() {
        await execFile(config.toolPath("modality"), [
            "segment",
            "use",
            "--whole-workspace",
            ...config.extraCliArgs("modality segment use"),
        ]);
        this.refresh();
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

export class UsedSegmentsChangeEvent {
    constructor(
        public usedSegmentConfig: cliConfig.ContextSegment,
        public activeSegmentIds: api.WorkspaceSegmentId[]
    ) {}
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
        const segDate = new Date(data.segment.latest_receive_time / 1_000_000);
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
