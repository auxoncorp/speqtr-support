import * as lodash from "lodash";
import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as commonNotebookCells from "../templates/common.json";
import * as eventTimingNotebookCells from "../templates/eventTiming.json";
import * as eventAttributeValuesNotebookCells from "../templates/eventAttributeValues.json";

export class EventsTreeDataProvider implements vscode.TreeDataProvider<EventsTreeItemData> {
    selectedTimelineId?: api.TimelineId = undefined;
    selectedTimelineName?: string = undefined;
    view: vscode.TreeView<EventsTreeItemData>;

    // Need these to generate the Jupyter notebooks
    activeWorkspaceVersionId: string;
    activeSegments: api.WorkspaceSegmentId[];

    private _onDidChangeTreeData: vscode.EventEmitter<EventsTreeItemData | EventsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<EventsTreeItemData | EventsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    constructor(private readonly apiClient: api.Client) {}

    register(context: vscode.ExtensionContext) {
        this.view = vscode.window.createTreeView("auxon.events", {
            treeDataProvider: this,
            canSelectMany: false,
        });
        context.subscriptions.push(
            this.view,
            vscode.commands.registerCommand("auxon.events.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.events.setSelectedTimeline", (timelineId, timelineName) =>
                this.setSelectedTimeline(timelineId, timelineName)
            ),
            vscode.commands.registerCommand("auxon.events.createEventTimingNotebook", async (itemData) =>
                this.createEventTimingNotebook(itemData)
            ),
            vscode.commands.registerCommand("auxon.events.createEventAttrNotebook", async (itemData) =>
                this.createEventAttrNotebook(itemData)
            )
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
        }
    }

    async getChildren(element?: EventsTreeItemData): Promise<EventsTreeItemData[]> {
        if (!this.selectedTimelineId) {
            return [];
        }

        if (!element) {
            const children = [];
            const eventsSummary = await this.apiClient.events().eventsSummaryForTimeline(this.selectedTimelineId);
            for (const summary of eventsSummary.events) {
                let name = summary.name;
                if (name === null) {
                    name = "<unnamed>";
                }
                const attrs = [];
                for (const attr of summary.attributes) {
                    if (attr.startsWith("event.")) {
                        attrs.push(attr.replace("event.", ""));
                    }
                }
                children.push(new EventNameTreeItemData(name, summary.n_instances, attrs));
            }
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

    async createEventTimingNotebook(item: EventNameTreeItemData) {
        const varMap = this.templateVariableMap();
        varMap["eventName"] = item.eventName;
        await this.createJupyterNotebook(eventTimingNotebookCells.cells, varMap);
    }

    async createEventAttrNotebook(item: EventAttributeTreeItemData) {
        const varMap = this.templateVariableMap();
        varMap["eventName"] = item.eventName;
        varMap["eventAttribute"] = item.attribute;
        await this.createJupyterNotebook(eventAttributeValuesNotebookCells.cells, varMap);
    }

    async createJupyterNotebook(notebookSrcCells: object[], templateVarMap: object) {
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

    convertNotebookCells(inputCells: object[]): vscode.NotebookCellData[] {
        const cells = [];
        for (const cell of inputCells) {
            const src = cell["source"].join("");
            if (cell["cell_type"] === "markdown") {
                cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, src, "markdown"));
            } else {
                cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, src, "python"));
            }
        }
        return cells;
    }

    templateVariableMap(): object {
        return {
            workspaceVersionId: this.activeWorkspaceVersionId,
            segments: this.activeSegments
                .map((seg) => {
                    return "'" + seg.segment_name + "'";
                })
                .join(","),
            timelineId: "%" + this.selectedTimelineId.replace(/-/g, ""),
            timelineName: this.selectedTimelineName,
        };
    }
}

export type EventsTreeItemData = EventNameTreeItemData | EventAttributeTreeItemData;
export type EventsTreeItem = EventNameTreeItem | EventAttributeTreeItem;

export class EventNameTreeItemData {
    constructor(public eventName: string, public numInstances: number, public attributes: string[]) {}
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
