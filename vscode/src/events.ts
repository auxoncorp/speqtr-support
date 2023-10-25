import * as vscode from "vscode";
import * as api from "./modalityApi";

export class EventsTreeDataProvider implements vscode.TreeDataProvider<EventsTreeItemData> {
    selectedTimelineId?: api.TimelineId = undefined;

    private _onDidChangeTreeData: vscode.EventEmitter<EventsTreeItemData | EventsTreeItemData[] | undefined> =
        new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<EventsTreeItemData | EventsTreeItemData[] | undefined> =
        this._onDidChangeTreeData.event;

    constructor(private readonly apiClient: api.Client) {}

    register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.window.createTreeView("auxon.events", {
                treeDataProvider: this,
            }),
            vscode.commands.registerCommand("auxon.events.refresh", () => this.refresh()),
            vscode.commands.registerCommand("auxon.events.setSelectedTimelineId", (itemData) =>
                this.setSelectedTimelineId(itemData)
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

    setSelectedTimelineId(timelineId?: api.TimelineId) {
        if (timelineId) {
            this.selectedTimelineId = timelineId;
            this.refresh();
        }
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
