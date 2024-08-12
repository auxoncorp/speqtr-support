import * as lodash from "lodash";
import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as modalityLog from "./modalityLog";
import * as workspaceState from "./workspaceState";
import * as modalityEventInspect from "./modalityEventInspect";

import * as commonNotebookCells from "./notebooks/common.json";
import * as eventTimingNotebookCells from "./notebooks/eventTiming.json";
import * as eventMultiAttributeValuesNotebookCells from "./notebooks/eventMultiAttributeValues.json";
type JupyterNotebookCell = (typeof commonNotebookCells.cells)[0];

export interface SelectedTimeline {
    timelineId: api.TimelineId;
    timelineName: string;
}

export class EventsTreeDataProvider implements vscode.TreeDataProvider<EventsTreeItemData> {
    selectedTimelines: SelectedTimeline[] = [];
    view: vscode.TreeView<EventsTreeItemData>;

    private _onDidChangeTreeData: vscode.EventEmitter<EventsTreeItemData | EventsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<EventsTreeItemData | EventsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    constructor(
        private readonly apiClient: api.Client,
        private wss: workspaceState.WorkspaceAndSegmentState,
        context: vscode.ExtensionContext
    ) {
        this.view = vscode.window.createTreeView("auxon.events", {
            treeDataProvider: this,
            canSelectMany: true,
        });
        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.events.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.events.logSelected", () => this.logSelectedCommand()),
            vscode.commands.registerCommand("auxon.events.createEventTimingNotebook", async (item) =>
                this.createEventTimingNotebook(item)
            ),
            vscode.commands.registerCommand("auxon.events.createEventAttrNotebook", async (itemData) =>
                this.createEventAttrNotebook(itemData)
            ),
            vscode.commands.registerCommand("auxon.events.inspect", (itemData) => this.inspectEventCommand(itemData)),
            this.wss.onDidChangeUsedSegments(() => this.refresh())
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: EventsTreeItemData): EventsTreeItem {
        if (element instanceof EventNameTreeItemData) {
            return new EventNameTreeItem(element);
        } else if (element instanceof EventAttributeTreeItemData) {
            return new EventAttributeTreeItem(element);
        } else {
            throw new Error("Unknown event tree item type");
        }
    }

    async getChildren(element?: EventsTreeItemData): Promise<EventsTreeItemData[]> {
        const children = await this.getChildrenInner(element);
        if (children.length === 0) {
            this.view.message = "Select a timeline to view its events.";
        } else {
            this.view.message = undefined;
        }
        return children;
    }

    private async getChildrenInner(element?: EventsTreeItemData): Promise<EventsTreeItemData[]> {
        if (this.selectedTimelines.length === 0) {
            return [];
        }

        if (!element) {
            const children = [];
            for (const selectedTimeline of this.selectedTimelines) {
                const eventsSummary = await this.apiClient
                    .events()
                    .eventsSummaryForTimeline(selectedTimeline.timelineId);
                for (const summary of eventsSummary.events) {
                    let name = summary.name;
                    if (name == null) {
                        name = "<unnamed>";
                    }
                    const attrs = [];
                    for (const attr of summary.attributes) {
                        if (attr.startsWith("event.")) {
                            attrs.push(attr.replace("event.", ""));
                        }
                    }
                    children.push(
                        new EventNameTreeItemData(
                            name,
                            summary.n_instances,
                            attrs,
                            selectedTimeline.timelineName,
                            selectedTimeline.timelineId
                        )
                    );
                }
            }

            children.sort((a, b) => a.eventName.localeCompare(b.eventName));
            return children;
        } else {
            if (element instanceof EventNameTreeItemData) {
                return element.attributes.map(
                    (attrKey) =>
                        new EventAttributeTreeItemData(
                            element.eventName,
                            element.timelineName,
                            element.timelineId,
                            attrKey
                        )
                );
            } else {
                return [];
            }
        }
    }

    setSelectedTimelines(timelines: SelectedTimeline[]) {
        this.selectedTimelines = timelines;
        this.refresh();
    }

    logSelectedCommand() {
        if (this.selectedTimelines.length === 0) {
            vscode.window.showWarningMessage(`No timeline is selected`);
            return;
        }

        const thingsToLog = [];
        for (const itemData of this.view.selection) {
            if (itemData instanceof EventNameTreeItemData && itemData.timelineId) {
                const literalTimelineId = "%" + itemData.timelineId.replace(/-/g, "");
                thingsToLog.push(`"${itemData.eventName}"@*(_.timeline.id=${literalTimelineId})`);
            }
        }
        if (thingsToLog.length !== 0) {
            vscode.commands.executeCommand(
                modalityLog.MODALITY_LOG_COMMAND,
                new modalityLog.ModalityLogCommandArgs({ thingToLog: thingsToLog })
            );
        }
    }

    async inspectEventCommand(item: EventNameTreeItemData) {
        if (item instanceof EventNameTreeItemData) {
            const literalTimelineId = "%" + item.timelineId.replace(/-/g, "");
            vscode.commands.executeCommand(modalityEventInspect.COMMAND, `'${item.eventName}'@${literalTimelineId}`);
        }
    }

    async createEventTimingNotebook(item: EventNameTreeItemData) {
        type SelectedEvent = {
            name: string;
            timelineId: api.TimelineId;
            timelineName: string;
        };

        const selection: EventNameTreeItemData[] = [];
        for (const item of this.view.selection) {
            if (item instanceof EventNameTreeItemData) {
                selection.push(item);
            }
        }
        // Add the item the command was executed on, it may not be in the selection
        selection.push(item);
        let selectedEvents: SelectedEvent[] = selection.map((data) => {
            return { name: data.eventName, timelineId: data.timelineId, timelineName: data.timelineName };
        });
        // dedupe
        selectedEvents = selectedEvents.filter(
            (v, i, a) => a.findIndex((v2) => JSON.stringify(v2) === JSON.stringify(v)) === i
        );
        for (const event of selectedEvents) {
            const varMap = this.templateVariableMap(event.timelineName, event.timelineId);
            if (varMap == null) {
                return;
            }
            varMap["eventName"] = event.name;
            await this.createJupyterNotebook(eventTimingNotebookCells.cells, varMap);
        }
    }

    async createEventAttrNotebook(item: EventAttributeTreeItemData) {
        type EventName = string;
        type EventMeta = {
            timelineName: string;
            attributes: Set<string>;
        };

        // Group attributes by event@timeline, we'll make a notebook for
        // each group
        const eventGroups = new Map<api.TimelineId, Map<EventName, EventMeta>>();
        for (const data of [...this.view.selection, ...[item]]) {
            if (data instanceof EventAttributeTreeItemData) {
                let eventToMeta = null;
                if (!eventGroups.has(data.timelineId)) {
                    eventGroups.set(data.timelineId, new Map<EventName, EventMeta>());
                }
                eventToMeta = eventGroups.get(data.timelineId);

                if (eventToMeta != null) {
                    let eventMeta = null;
                    if (!eventToMeta.has(data.eventName)) {
                        eventToMeta.set(data.eventName, {
                            timelineName: data.timelineName,
                            attributes: new Set<string>(),
                        });
                    }
                    eventMeta = eventToMeta.get(data.eventName);

                    if (eventMeta != null) {
                        eventMeta.attributes.add(data.attribute);
                    }
                }
            }
        }

        for (const [timelineId, eventToMeta] of eventGroups) {
            for (const [eventName, eventMeta] of eventToMeta) {
                const varMap = this.templateVariableMap(eventMeta.timelineName, timelineId);
                if (varMap == null) {
                    return;
                }

                varMap.eventName = eventName;
                const cells = lodash.cloneDeep(eventMultiAttributeValuesNotebookCells.cells.slice(0, 2));
                const srcCell = eventMultiAttributeValuesNotebookCells.cells[2];
                const figShowCell = eventMultiAttributeValuesNotebookCells.cells[3];
                const eventAttributesList: string[] = [];
                Array.from(eventMeta.attributes).forEach((attr, i) => {
                    eventAttributesList.push("'event." + attr + "'");
                    varMap["eventAttribute" + i] = attr;
                    const newSrc = srcCell.source[0].replace(/eventAttribute/g, "eventAttribute" + i);
                    cells[1].source.push(newSrc);
                });
                cells[1].source.push(figShowCell.source[0]);

                varMap.eventAttributes = eventAttributesList.join(", ");

                await this.createJupyterNotebook(cells, varMap);
            }
        }
    }

    async createJupyterNotebook(notebookSrcCells: JupyterNotebookCell[], templateVarMap: object) {
        const cells = [];

        // Use a custom delimiter ${ }
        lodash.templateSettings.interpolate = /\${([\s\S]+?)}/g;

        const notebookCells = this.convertNotebookCells(notebookSrcCells).map((cell) => {
            const template = lodash.template(cell.value);
            const compiled = template(templateVarMap);
            cell.value = compiled;
            return cell;
        });

        // Prefix with common cells, followed by the notebook cells
        for (const cell of this.convertNotebookCells(commonNotebookCells.cells)) {
            cells.push(cell);
        }
        for (const cell of notebookCells) {
            cells.push(cell);
        }

        const data = new vscode.NotebookData(cells);
        data.metadata = {
            custom: {
                cells: [],
                metadata: commonNotebookCells.metadata,
                nbformat: 4,
                nbformat_minor: 2,
            },
        };

        const doc = await vscode.workspace.openNotebookDocument("jupyter-notebook", data);
        await vscode.window.showNotebookDocument(doc);

        vscode.commands.executeCommand("notebook.cell.collapseAllCellInputs", {
            ranges: [],
            document: doc.uri,
        });
    }

    convertNotebookCells(inputCells: JupyterNotebookCell[]): vscode.NotebookCellData[] {
        const cells = [];
        for (const cell of inputCells) {
            const src = cell.source.join("");
            if (cell.cell_type === "markdown") {
                cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, src, "markdown"));
            } else {
                cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, src, "python"));
            }
        }
        return cells;
    }

    templateVariableMap(timelineName: string, timelineId: api.TimelineId): TemplateVariableMap | undefined {
        let segments: string;
        switch (this.wss.activeSegments.type) {
            case "WholeWorkspace":
                vscode.window.showWarningMessage(`This notebook is not supported in 'whole workspace' mode.`);
                return undefined;
            case "Explicit": {
                segments = this.wss.activeSegments.segmentIds
                    .map((seg) => {
                        return "'" + seg.segment_name + "'";
                    })
                    .join(",");
            }
        }

        return {
            workspaceVersionId: this.wss.activeWorkspaceVersionId,
            segments,
            timelineId: "%" + timelineId.replace(/-/g, ""),
            timelineName: timelineName,
        };
    }
}

interface TemplateVariableMap {
    workspaceVersionId: string;
    segments: string;
    timelineId: string;
    timelineName: string;
    eventName?: string;
    eventAttribute?: string;
    eventAttributes?: string;

    [k: string]: unknown;
}

export type EventsTreeItemData = EventNameTreeItemData | EventAttributeTreeItemData;
export type EventsTreeItem = EventNameTreeItem | EventAttributeTreeItem;

export class EventNameTreeItemData {
    constructor(
        public eventName: string,
        public numInstances: number,
        public attributes: string[],
        public timelineName: string,
        public timelineId: api.TimelineId
    ) {}

    getModalityLogCommandArgs(): modalityLog.ModalityLogCommandArgs {
        const literalTimelineId = "%" + this.timelineId.replace(/-/g, "");
        return new modalityLog.ModalityLogCommandArgs({
            thingToLog: `'${this.eventName}'@*(_.timeline.id=${literalTimelineId})`,
        });
    }
}

class EventNameTreeItem extends vscode.TreeItem {
    contextValue = "event";

    constructor(public readonly data: EventNameTreeItemData) {
        super(
            data.eventName,
            (data.attributes.length ?? 0) > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        let tooltip = `${data.eventName} @ ${data.timelineName}`;
        tooltip += `\n- **Instances**:: ${data.numInstances}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }
}

export class EventAttributeTreeItemData {
    constructor(
        public eventName: string,
        public timelineName: string,
        public timelineId: api.TimelineId,
        public attribute: string
    ) {}
}

class EventAttributeTreeItem extends vscode.TreeItem {
    contextValue = "eventAttribute";

    constructor(public readonly data: EventAttributeTreeItemData) {
        super(data.attribute, vscode.TreeItemCollapsibleState.None);
    }
}
