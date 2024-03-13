import React, {
    Fragment,
    MutableRefObject,
    ReactNode,
    createElement,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { createRoot } from "react-dom/client";
import * as transitionGraphWebViewApi from "../common-src/transitionGraphWebViewApi";
import * as cytoscape from "./components/cytoscape";

import * as vw from "vscode-webview";
const vscode: vw.WebviewApi<PersistentState> = acquireVsCodeApi();

import * as wvtk from "@vscode/webview-ui-toolkit";
wvtk.provideVSCodeDesignSystem()
    .register(wvtk.vsCodeButton())
    .register(wvtk.vsCodeDropdown())
    .register(wvtk.vsCodeOption())
    .register(wvtk.vsCodeProgressRing());

class PersistentState {
    layout: cytoscape.LayoutType;
    selectionMode: cytoscape.GraphSelectionMode;

    pan: cytoscape.Position;
    zoom: number;
    selection: cytoscape.Selection;

    nodeCoordinates?: cytoscape.NodePositionMap;
}

const root = createRoot(document.getElementById("app")!);
root.render(<App />);

let didInit = false;

function App() {
    const [loading, setLoading] = useState(true);
    const [graphElements, setGraphElements] = useState<cytoscape.GraphElements>({ nodes: [], edges: [] });

    const [layout, setLayout] = useState<cytoscape.LayoutType>("cose-bilkent");
    const [selectionMode, setSelectionMode] = useState<cytoscape.GraphSelectionMode>("manual");
    const [selection, setSelection] = useState<cytoscape.Selection>({ nodes: [], edges: [] });

    let initialPan = { x: 0, y: 0 };
    let initialZoom = 1.25;

    const [nodeCoordinates, setNodeCoordinates] = useState<cytoscape.NodePositionMap | undefined>();
    const cyRef: MutableRefObject<cytoscape.Core | undefined> = useRef();

    if (!didInit) {
        // Attach window events to process messages from vscode on startup
        const onMessage = (event: MessageEvent<transitionGraphWebViewApi.WebViewMessage>) =>
            onVSCodeMessage(event, setGraphElements, setLoading);
        window.addEventListener("message", onMessage);
        vscode.postMessage({ command: "requestNodesAndEdges" });

        document.addEventListener("auxon.savePng", () => {
            if (cyRef.current != null) {
                savePng(cyRef.current);
            }
        });

        // Load state on startup
        const s = vscode.getState();
        if (s != null) {
            setLayout(s.layout);
            setSelectionMode(s.selectionMode);
            setSelection(s.selection);
            initialPan = s.pan;
            initialZoom = s.zoom;
            setNodeCoordinates(s.nodeCoordinates);
        }
    }

    const [pan, setPan] = useState(initialPan);
    const [zoom, setZoom] = useState(initialZoom);

    // Flush state to vscode whenever it changes
    useEffect(() => {
        // Don't save state during the init process, when we're loading all of these
        if (!didInit) {
            return;
        }
        vscode.setState({ layout, selectionMode, pan, zoom, selection, nodeCoordinates });
    }, [layout, selectionMode, pan, zoom, selection, nodeCoordinates]);

    didInit = true;

    const getNodeDataById = useCallback((id: string): transitionGraphWebViewApi.NodeData | undefined => {
        return cyRef.current?.getElementById(id)?.data();
    }, []);

    const getEdgeDataById = useCallback(
        (id: string): transitionGraphWebViewApi.EdgeData | undefined => {
            return cyRef.current?.getElementById(id)?.data();
        },
        [getNodeDataById]
    );

    const onLogSelectedNodes = useCallback((selection: cytoscape.Selection) => {
        // notNullOrUndefined has to be a standalone type-predicate-style function for this to typecheck
        const thingsToLog = selection.nodes
            .map((id) => getNodeDataById(id))
            .filter(notNullOrUndefined)
            .map(thingToLogForNodeData)
            .filter(notNullOrUndefined);
        const msg: transitionGraphWebViewApi.LogSelectedNodesCommand = {
            command: "logSelectedNodes",
            thingsToLog,
        };
        vscode.postMessage(msg);
    }, []);

    return createElement(Fragment, {}, [
        createElement(Sidebar, {
            selectedLayout: layout,
            onSelectedLayout: setLayout,

            selectionMode,
            onSelectionMode: setSelectionMode,

            selection,
            getNodeDataById,
            getEdgeDataById,
        }),

        loading ? (
            <div id="loading">
                <VSCodeProgressRing />
                <h1>Loading...</h1>
            </div>
        ) : (
            createElement(cytoscape.CytoscapeReact, {
                id: "cy",
                cyRef: cyRef,
                graphElements,
                layout,
                selectionMode,
                selection,
                onSelection: setSelection,
                pan,
                onPan: setPan,
                zoom,
                onZoom: setZoom,
                nodeCoordinates,
                onNodeCoordinates: setNodeCoordinates,
                onLogSelectedNodes,
            })
        ),
    ]);
}

function onVSCodeMessage(
    event: MessageEvent<transitionGraphWebViewApi.WebViewMessage>,
    setGraphElements: (elements: cytoscape.GraphElements) => void,
    setLoading: (loading: boolean) => void
) {
    switch (event.data.command) {
        case "nodesAndEdges":
            cytoscape.calculateLabelHeightsAndWidths(event.data.nodes);
            setGraphElements({ nodes: event.data.nodes, edges: event.data.edges });
            setLoading(false);
            break;
        case "themeChanged":
            document.dispatchEvent(new Event("auxon.themeChanged"));
            break;
    }
}

interface SidebarProps {
    selectedLayout: cytoscape.LayoutType;
    onSelectedLayout: (l: cytoscape.LayoutType) => void;

    selectionMode: cytoscape.GraphSelectionMode;
    onSelectionMode: (s: cytoscape.GraphSelectionMode) => void;

    selection: cytoscape.Selection;
    getNodeDataById: (id: string) => transitionGraphWebViewApi.NodeData | undefined;
    getEdgeDataById: (id: string) => transitionGraphWebViewApi.EdgeData | undefined;
}

function Sidebar(props: SidebarProps) {
    return (
        <div id="sidebar">
            <div id="actions">
                <VSCodeButton
                    id="toolbarSave"
                    appearance="secondary"
                    aria-label="Save Image"
                    onClick={() => document.dispatchEvent(new Event("auxon.savePng"))}
                >
                    Save Image
                    <span slot="start" className="codicon codicon-save"></span>
                </VSCodeButton>
                <VSCodeButton
                    id="toolbarRefresh"
                    appearance="secondary"
                    aria-label="Refresh Layout"
                    onClick={() => document.dispatchEvent(new Event("auxon.refresh"))}
                >
                    Refresh Layout
                    <span slot="start" className="codicon codicon-refresh"></span>
                </VSCodeButton>
            </div>

            <div className="dropdown-grid">
                <div className="dropdown-grid-row">
                    <label htmlFor="layoutDropdown">Graph Layout</label>
                    <LayoutDropdown selectedLayout={props.selectedLayout} onSelectedLayout={props.onSelectedLayout} />
                </div>

                <div className="dropdown-grid-row">
                    <label htmlFor="modeDropdown">Selection Mode</label>
                    <SelectionModeDropdown
                        selectionMode={props.selectionMode}
                        onSelectionMode={props.onSelectionMode}
                    />
                </div>
            </div>

            <div style={{ overflowX: "clip", overflowY: "scroll" }}>
                <DetailsGrid
                    selection={props.selection}
                    getNodeDataById={props.getNodeDataById}
                    getEdgeDataById={props.getEdgeDataById}
                />

                <div id="impactDetailsContainer" className="detail-container">
                    {props.selection.nodes.map((id) => {
                        const nodeData = props.getNodeDataById(id);
                        if (nodeData?.impactHtml != null) {
                            return (
                                <div
                                    key={"imacthtml-" + id}
                                    dangerouslySetInnerHTML={{ __html: nodeData.impactHtml }}
                                />
                            );
                        }
                    })}
                </div>
            </div>
        </div>
    );
}

function savePng(cy: cytoscape.Core) {
    const options: cytoscape.ExportStringOptions = {
        output: "base64uri",
        bg: "transparent",
        full: true,
    };
    const cyPng = cy.png(options);
    const msg: transitionGraphWebViewApi.SaveAsPngCommand = {
        command: "saveAsPng",
        data: cyPng,
    };
    vscode.postMessage(msg);
}

interface LayoutDropdownProps {
    selectedLayout: cytoscape.LayoutType;
    onSelectedLayout: (l: cytoscape.LayoutType) => void;
}

function LayoutDropdown(props: LayoutDropdownProps): ReactNode {
    const options: [cytoscape.LayoutType, string][] = [
        ["cose-bilkent", "Cose Bilkent"],
        ["cose", "Cose"],
        ["breadthfirst", "Breadth first"],
        ["concentric", "Concentric"],
        ["circle", "Circle"],
        ["grid", "Grid"],
        ["random", "Random"],
    ];

    function setValue(value: string) {
        if (cytoscape.isLayoutType(value)) {
            props.onSelectedLayout(value);
        }
    }

    return createElement(ReactiveDropdown, { options, onChange: setValue, value: props.selectedLayout });
}

interface SelectionModeDropdownProps {
    selectionMode: cytoscape.GraphSelectionMode;
    onSelectionMode: (s: cytoscape.GraphSelectionMode) => void;
}

function SelectionModeDropdown(props: SelectionModeDropdownProps): ReactNode {
    const options: [cytoscape.GraphSelectionMode, string][] = [
        ["manual", "Standard"],
        ["causal-descendants", "Causal Descendants"],
        ["causal-ancestors", "Causal Ancestors"],
        ["bidirectional-neighbors", "Neighbors"],
        ["downstream-neighbors", "Downstream Neighbors"],
        ["upstream-neighbors", "Upstream Neighbors"],
    ];

    function setValue(value: string) {
        if (cytoscape.isSelectionMode(value)) {
            props.onSelectionMode(value);
        }
    }

    return createElement(ReactiveDropdown, { options, onChange: setValue, value: props.selectionMode });
}

interface ReactiveDropdownProps<T extends string> {
    options: [T, string][];
    value: T;
    onChange: (s: string) => void;
}

/**
 * A dropdown menu that takes its value from a prop, and then calls a
 * setter whenever the selected value changes.
 */
function ReactiveDropdown<T extends string>(props: ReactiveDropdownProps<T>): ReactNode {
    // The onChange field of the VSCodeDropdown component is not
    // sanely typed. So we just type it as any and downcast it to the
    // type we actually observe in the debugger.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function onChange(e: any) {
        const ev = e as CustomEvent;
        if (ev.target == null) {
            return;
        }

        const target = ev.target as HTMLSelectElement;
        props.onChange(target.value);
    }

    const options = props.options.map(([value, text], index) => (
        <VSCodeOption key={"option" + index} value={value}>
            {text}
        </VSCodeOption>
    ));
    return (
        <VSCodeDropdown currentValue={props.value} onChange={onChange}>
            {options}
        </VSCodeDropdown>
    );
}

interface DetailsGridProps {
    selection: cytoscape.Selection;
    getNodeDataById: (id: string) => transitionGraphWebViewApi.NodeData | undefined;
    getEdgeDataById: (id: string) => transitionGraphWebViewApi.EdgeData | undefined;
}

/**
 * A grid of details about selected nodes and edges
 */
function DetailsGrid(props: DetailsGridProps): ReactNode {
    const nodesWithEventName: transitionGraphWebViewApi.NodeData[] = [];
    const nodesWithTimelineId: transitionGraphWebViewApi.NodeData[] = [];
    for (const nodeId of props.selection.nodes) {
        const nodeData = props.getNodeDataById(nodeId);
        if (nodeData != null) {
            if (nodeData.eventName != null) {
                nodesWithEventName.push(nodeData);
            }
            if (nodeData.timeline != null) {
                nodesWithTimelineId.push(nodeData);
            }
        }
    }

    const edges: transitionGraphWebViewApi.EdgeData[] = [];
    for (const edgeId of props.selection.edges) {
        const edgeData = props.getEdgeDataById(edgeId);
        if (edgeData != null) {
            edges.push(edgeData);
        }
    }

    const eventHeaders = ["Event Name", "Count"];
    const eventRows = nodesWithEventName.map((n) => [cellTextForNode(n), n.count?.toString()]);

    const timelineHeaders = ["Timeline Name", "Timeline Id"];
    const timelineRows = nodesWithTimelineId.map((n) => [n.timelineName, formatTimelineId(n.timeline || "")]);

    const interactionHeaders = ["Interaction Source", "Count", "Destination"];
    const interactionRows = edges.flatMap((e: transitionGraphWebViewApi.EdgeData) => {
        const sourceNode = props.getNodeDataById(e.source);
        const destNode = props.getNodeDataById(e.target);
        if (sourceNode == null || destNode == null) {
            return [];
        }

        return [[cellTextForNode(sourceNode), e.count?.toString(), cellTextForNode(destNode)]];
    });

    return (
        <div className="vsc-grid" aria-label="Selection Details">
            <DetailsGridSection keyPrefix="event" headers={eventHeaders} colSpans={[1, 2]} rows={eventRows} />
            <DetailsGridSection keyPrefix="timeline" headers={timelineHeaders} colSpans={[1, 2]} rows={timelineRows} />
            <DetailsGridSection
                keyPrefix="interaction"
                headers={interactionHeaders}
                colSpans={[1, 1, 1]}
                rows={interactionRows}
            />
        </div>
    );
}

interface DetailsGridSectionProps {
    keyPrefix: string;
    headers: string[];
    colSpans: number[];
    rows: (string | undefined)[][];
}

function DetailsGridSection(props: DetailsGridSectionProps): ReactNode | undefined {
    if (props.rows.length == 0) {
        return;
    }

    const headerCols = props.headers.map((h, index) => (
        <div
            key={props.keyPrefix + "-header-" + index}
            className="vsc-grid-cell column-header"
            style={{ gridColumn: "span " + props.colSpans[index] }}
        >
            {h}
        </div>
    ));

    const rows = props.rows.map((cells, rowIndex) => (
        <React.Fragment key={props.keyPrefix + "-row-frag-" + rowIndex}>
            <div key={props.keyPrefix + "-row-" + rowIndex} className="vsc-grid-row" style={{ gridColumn: "span 3" }}>
                {cells.map((cell, colIndex) => (
                    <div
                        key={props.keyPrefix + "-row-" + rowIndex + "-col-" + colIndex}
                        className="vsc-grid-cell"
                        style={{ gridColumn: "span " + props.colSpans[colIndex] }}
                    >
                        {cell}
                    </div>
                ))}
            </div>
        </React.Fragment>
    ));

    return (
        <React.Fragment key={props.keyPrefix + "-frag"}>
            <div
                key={props.keyPrefix + "-section-header"}
                className="vsc-grid-row header"
                style={{ gridColumn: "span 3" }}
            >
                {headerCols}
            </div>
            {rows}
        </React.Fragment>
    );
}

/**
 * The text we should write in a cell of the details table, for
 * describing a single graph node.
 */
function cellTextForNode(node: transitionGraphWebViewApi.NodeData): string {
    if (node.eventName && node.timelineName) {
        return `${node.eventName}@${node.timelineName}`;
    } else if (node.timelineName && node.timeline) {
        return `${node.timelineName} (${formatTimelineId(node.timeline)})`;
    } else if (node.timelineName) {
        return node.timelineName;
    } else {
        return "";
    }
}

/**
 * Format a uuid-style timeline id in %-style, so it can be pasted into the cli
 */
function formatTimelineId(timelineId: string): string {
    let s = timelineId.replaceAll("-", "");
    if (!s.startsWith("%")) {
        s = "%" + s;
    }
    return s;
}

function notNullOrUndefined<T>(value: T): value is NonNullable<T> {
    return value != null;
}

/**
 * When the user asks to log a particular node in the graph, what should we pass to 'modality log'?
 */
function thingToLogForNodeData(node: transitionGraphWebViewApi.NodeData): string | undefined {
    if (node.timeline && node.eventName) {
        return `"${node.eventName}"@${formatTimelineId(node.timeline)}`;
    }
    if (node.timelineName && node.eventName) {
        return `"${node.eventName}"@${node.timelineName}`;
    }
    if (node.timeline) {
        return formatTimelineId(node.timeline);
    }
    if (node.timelineName) {
        return node.timelineName;
    }
    return undefined;
}
