import * as lodash from "lodash";
import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as modalityLog from "./modalityLog";
import * as workspaceState from "./workspaceState";
import * as modalityEventInspect from "./modalityEventInspect";

import * as commonNotebookCells from "./notebooks/common.json";
import * as eventTimingNotebookCells from "./notebooks/eventTiming.json";
import * as eventAttributeValuesNotebookCells from "./notebooks/eventAttributeValues.json";
import * as eventMultiAttributeValuesNotebookCells from "./notebooks/eventMultiAttributeValues.json";
type JupyterNotebookCell = (typeof commonNotebookCells.cells)[0];

export class EventsTreeDataProvider implements vscode.TreeDataProvider<EventsTreeItemData> {
    selectedTimelineId?: api.TimelineId = undefined;
    selectedTimelineName?: string = undefined;
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
            vscode.commands.registerCommand("auxon.events.setSelectedTimeline", (timelineId, timelineName) =>
                this.setSelectedTimeline(timelineId, timelineName)
            ),
            vscode.commands.registerCommand("auxon.events.createEventTimingNotebook", async (item) =>
                this.createEventTimingNotebook(item)
            ),
            vscode.commands.registerCommand("auxon.events.createEventAttrNotebook", async (itemData) =>
                this.createEventAttrNotebook(itemData)
            ),
            vscode.commands.registerCommand("auxon.events.inspect", (itemData) => this.inspectEventCommand(itemData))
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
        if (!this.selectedTimelineId) {
            return [];
        }

        if (!element) {
            const children = [];
            const eventsSummary = await this.apiClient.events().eventsSummaryForTimeline(this.selectedTimelineId);
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
                children.push(new EventNameTreeItemData(name, summary.n_instances, attrs, this.selectedTimelineId));
            }

            children.sort((a, b) => a.eventName.localeCompare(b.eventName));
            return children;
        } else {
            if (element instanceof EventNameTreeItemData) {
                return element.attributes.map((attrKey) => new EventAttributeTreeItemData(element.eventName, attrKey));
            } else {
                return [];
            }
        }
    }

    setSelectedTimeline(timelineId?: api.TimelineId, timelineName?: string) {
        if (timelineId && timelineName) {
            this.selectedTimelineId = timelineId;
            this.selectedTimelineName = timelineName;
            this.refresh();
        }
    }

    logSelectedCommand() {
        if (this.selectedTimelineId == null) {
            vscode.window.showWarningMessage(`No timeline is selected`);
            return;
        }

        const thingsToLog = [];
        const literalTimelineId = "%" + this.selectedTimelineId.replace(/-/g, "");

        for (const itemData of this.view.selection) {
            thingsToLog.push(`${itemData.eventName}@*(_.timeline.id=${literalTimelineId})`);
        }
        vscode.commands.executeCommand(
            modalityLog.MODALITY_LOG_COMMAND,
            new modalityLog.ModalityLogCommandArgs({ thingToLog: thingsToLog })
        );
    }

    async createEventTimingNotebook(item: EventNameTreeItemData) {
        let selectedEventNames = this.view.selection.map((data) => data.eventName);
        // Add the item the command was executed on, it may not be in the selection
        selectedEventNames.push(item.eventName);
        selectedEventNames = [...new Set(selectedEventNames)]; // dedupe
        for (const eventName of selectedEventNames) {
            const varMap = this.templateVariableMap();
            if (varMap == null) {
                return;
            }
            varMap["eventName"] = eventName;
            await this.createJupyterNotebook(eventTimingNotebookCells.cells, varMap);
        }
    }

    async inspectEventCommand(item: EventNameTreeItemData) {
        if (item instanceof EventNameTreeItemData) {
            const literalTimelineId = "%" + item.timelineId.replace(/-/g, "");
            vscode.commands.executeCommand(modalityEventInspect.COMMAND, `'${item.eventName}'@${literalTimelineId}`);
        }
    }

    async createEventAttrNotebook(item: EventAttributeTreeItemData) {
        if (this.view.selection.length == 1) {
            const varMap = this.templateVariableMap();
            if (varMap == null) {
                return;
            }

            varMap.eventName = item.eventName;
            varMap.eventAttribute = item.attribute;
            await this.createJupyterNotebook(eventAttributeValuesNotebookCells.cells, varMap);
        } else {
            let selectedEventAttrs = [...this.view.selection, ...[item]];
            selectedEventAttrs = [...new Set(selectedEventAttrs)]; // dedupe

            const attributesByEvent = new Map<string, string[]>();
            for (const ev of selectedEventAttrs) {
                if (!(ev instanceof EventAttributeTreeItemData)) {
                    throw new Error("Internal error: event tree node not of expected type");
                }
                if (attributesByEvent.has(ev.eventName)) {
                    const attributes = attributesByEvent.get(ev.eventName);
                    if (attributes != null) {
                        attributes.push(ev.attribute);
                    }
                } else {
                    const attributes = [];
                    attributes.push(ev.attribute);
                    attributesByEvent.set(ev.eventName, attributes);
                }
            }

            attributesByEvent.forEach(async (attributes: string[], eventName: string) => {
                const varMap = this.templateVariableMap();
                if (varMap == null) {
                    return;
                }

                varMap.eventName = eventName;
                const cells = lodash.cloneDeep(eventMultiAttributeValuesNotebookCells.cells.slice(0, 2));
                const srcCell = eventMultiAttributeValuesNotebookCells.cells[2];
                const figShowCell = eventMultiAttributeValuesNotebookCells.cells[3];
                const eventAttributesList = [];
                for (let i = 0; i < attributes.length; i++) {
                    eventAttributesList.push("'event." + attributes[i] + "'");
                    varMap["eventAttribute" + i] = attributes[i];
                    const newSrc = srcCell.source[0].replace(/eventAttribute/g, "eventAttribute" + i);
                    cells[1].source.push(newSrc);
                }
                cells[1].source.push(figShowCell.source[0]);

                varMap.eventAttributes = eventAttributesList.join(", ");

                await this.createJupyterNotebook(cells, varMap);
            });
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

    templateVariableMap(): TemplateVariableMap | undefined {
        let segments: string;
        switch (this.wss.activeSegments.type) {
            case "WholeWorkspace":
                vscode.window.showWarningMessage(`This notebook is not supported in 'whole workspace' mode.`);
                return;
            case "Explicit": {
                segments = this.wss.activeSegments.segmentIds
                    .map((seg) => {
                        return "'" + seg.segment_name + "'";
                    })
                    .join(",");
            }
        }

        if (this.selectedTimelineId == null || this.selectedTimelineName == null) {
            vscode.window.showWarningMessage(`A timeline must be selected to generate a notebook`);
            return;
        }

        return {
            workspaceVersionId: this.wss.activeWorkspaceVersionId,
            segments,
            timelineId: "%" + this.selectedTimelineId.replace(/-/g, ""),
            timelineName: this.selectedTimelineName,
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
        public timelineId: api.TimelineId
    ) {}

    getModalityLogCommandArgs(): modalityLog.ModalityLogCommandArgs {
        const literalTimelineId = "%" + this.timelineId.replace(/-/g, "");
        return new modalityLog.ModalityLogCommandArgs({
            thingToLog: `${this.eventName}@*(_.timeline.id=${literalTimelineId})`,
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
        const tooltip = `- **Instances**:: ${data.numInstances}`;
        this.tooltip = new vscode.MarkdownString(tooltip);
    }
}

export class EventAttributeTreeItemData {
    constructor(public eventName: string, public attribute: string) {}
}

class EventAttributeTreeItem extends vscode.TreeItem {
    contextValue = "eventAttribute";

    constructor(public readonly data: EventAttributeTreeItemData) {
        super(data.attribute, vscode.TreeItemCollapsibleState.None);
    }
}
