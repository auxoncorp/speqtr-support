import { MutableRefObject, ReactNode, createElement, useEffect, useRef } from "react";
import * as transitionGraphWebViewApi from "../../common-src/transitionGraphWebViewApi";
import * as cytoscapeExtTypes from "../cytoscapeExtTypes";

import Cytoscape from "cytoscape";
export { Core, ExportStringOptions, NodePositionMap, Position } from "cytoscape";

import contextMenus from "cytoscape-context-menus";
import coseBilkent from "cytoscape-cose-bilkent";

Cytoscape.use(contextMenus);
Cytoscape.use(coseBilkent);

export interface GraphElements {
    nodes: cytoscape.NodeDefinition[];
    edges: cytoscape.EdgeDefinition[];
}

export interface Selection {
    nodes: string[];
    edges: string[];
}

export type LayoutType = "cose-bilkent" | "breadthfirst" | "cose" | "concentric" | "circle" | "grid" | "random";
const validLayouts = ["cose-bilkent", "breadthfirst", "cose", "concentric", "circle", "grid", "random"];
export function isLayoutType(s: string): s is LayoutType {
    return !!validLayouts.find((l) => s === l);
}

export type GraphSelectionMode =
    | "manual"
    | "bidirectional-neighbors"
    | "upstream-neighbors"
    | "downstream-neighbors"
    | "causal-descendants"
    | "causal-ancestors";
const validSelectionModes = [
    "manual",
    "bidirectional-neighbors",
    "upstream-neighbors",
    "downstream-neighbors",
    "causal-descendants",
    "causal-ancestors",
];
export function isSelectionMode(s: string): s is GraphSelectionMode {
    return !!validSelectionModes.find((m) => s === m);
}

export type EdgeLabelMode = "none" | "count" | "percentOfSource";
const validEdgeLabelModes = ["none", "count", "percentOfSource"];
export function isEdgeLayoutMode(s: string): s is EdgeLabelMode {
    return !!validEdgeLabelModes.find((l) => s === l);
}

export interface CytoscapeProps {
    /** id attribute for the generated DOM element */
    id: string;

    /** The data to put in the graph */
    graphElements: GraphElements;

    layout: LayoutType;
    selectionMode: GraphSelectionMode;
    edgeLabelMode: EdgeLabelMode;

    pan: cytoscape.Position;
    onPan(pan: cytoscape.Position): void;

    zoom: number;
    onZoom(zoom: number): void;

    selection: Selection;
    onSelection(selection: Selection): void;

    nodeCoordinates?: cytoscape.NodePositionMap;
    onNodeCoordinates(nodeCoordinates: cytoscape.NodePositionMap): void;

    onLogSelectedNodes(selection: Selection): void;

    /** Like 'ref' on normal react elements, but gives back a ref to the cytoscape core */
    cyRef?: MutableRefObject<cytoscape.Core | undefined>;
}

/**
 * A cytoscape graph viewer that is set up with vscode visual styling,
 * and knows about our selection modes and pre-chosen layout
 * parameters.
 */
export function CytoscapeReact(props: CytoscapeProps): ReactNode {
    const containerRef = useRef<HTMLElement | undefined>();
    const cyRef = useRef<cytoscape.Core | undefined>();

    // These refs are captured by the component mount/unmount useEffect
    // closure below. Their contents are updated by the props.selectionMode effect handler.
    const selectionModeRef = useRef<GraphSelectionMode>("manual");
    const layoutTypeRef = useRef<LayoutType>("cose-bilkent");
    const edgeLabelModeRef = useRef<EdgeLabelMode>("none");

    // Compount mount/unmount effect
    useEffect(() => {
        const cy = Cytoscape({
            container: containerRef.current,
            elements: props.graphElements.nodes.concat(props.graphElements.edges),
            layout: layoutOptions(props.layout, props.nodeCoordinates),
            data: { layoutName: props.layout },
            style: makeCytoscapeStylesheet(props.edgeLabelMode),
            pan: props.pan,
            minZoom: 0,
            zoom: props.zoom,
            maxZoom: 4,
            wheelSensitivity: 0.1,
        });

        props.selection.nodes.forEach((n) => cy.$id(n)?.select());
        props.selection.edges.forEach((e) => cy.$id(e)?.select());

        cy.on("select", (e) => onSelect(e, selectionModeRef.current, props.onSelection));
        cy.on("unselect", (e) => onUnselect(e, selectionModeRef.current, props.onSelection));
        cy.on("pan", () => props.onPan(cy.pan()));
        cy.on("zoom", () => props.onZoom(cy.zoom()));
        cy.on("position", () => onPosition(cy, props.onNodeCoordinates));

        const contextMenu = cy.contextMenus({
            menuItems: [
                {
                    id: "log-selected-nodes",
                    content: "Log Selected Nodes",
                    selector: "node, edge",
                    coreAsWell: false,
                    show: false,
                    onClickFunction: function () {
                        const selection = {
                            nodes: cy
                                .nodes()
                                .filter((n) => n.selected())
                                .map((n) => n.id()),
                            edges: [],
                        };
                        props.onLogSelectedNodes(selection);
                    },
                },
            ],
        });

        cy.on("cxttap", function () {
            const numSelectedNodes = cy.nodes().filter((n) => n.selected() && n.data().timeline !== undefined).length;
            if (numSelectedNodes > 0) {
                contextMenu.showMenuItem("log-selected-nodes");
            } else {
                contextMenu.hideMenuItem("log-selected-nodes");
            }
        });

        document.addEventListener("auxon.refresh", () => {
            const layout = cy.layout(layoutOptions(layoutTypeRef.current));
            layout.run();
        });

        document.addEventListener("auxon.themeChanged", () => {
            cy.style(makeCytoscapeStylesheet(edgeLabelModeRef.current));
        });

        cyRef.current = cy;
        if (props.cyRef != null) {
            props.cyRef.current = cy;
        }
        return () => {
            if (cyRef.current != null) {
                cyRef.current.destroy();
                cyRef.current = undefined;
                if (props.cyRef != null) {
                    props.cyRef.current = undefined;
                }
            }
        };
    }, []);

    // Property change effects
    useEffect(() => {
        if (cyRef.current != null && props.layout != cyRef.current.data("layoutName")) {
            const newLayout = cyRef.current.layout(layoutOptions(props.layout));
            newLayout.run();
            cyRef.current.data("layoutName", props.layout);
            layoutTypeRef.current = props.layout;
        }
    }, [props.layout]);

    useEffect(() => {
        selectionModeRef.current = props.selectionMode;
    }, [props.selectionMode]);

    useEffect(() => {
        if (cyRef.current != null && props.zoom != cyRef.current.zoom()) {
            cyRef.current.zoom(props.zoom);
        }
    }, [props.zoom]);

    useEffect(() => {
        if (cyRef.current != null) {
            const currentPan = cyRef.current.pan();
            if (props.pan.x !== currentPan.x || props.pan.y !== currentPan.y) {
                cyRef.current.pan(props.pan);
            }
        }
    }, [props.pan]);

    useEffect(() => {
        edgeLabelModeRef.current = props.edgeLabelMode;
        cyRef.current?.style(makeCytoscapeStylesheet(props.edgeLabelMode));
    }, [props.edgeLabelMode]);

    return createElement("div", { ref: containerRef, id: props.id });
}

function makeCytoscapeStylesheet(edgeLabelMode: EdgeLabelMode): cytoscape.Stylesheet[] {
    // Get the doc styles to access vscode theme colors
    const browserStyle = getComputedStyle(document.body);

    return [
        {
            selector: "node",
            style: {
                width: "data(width)",
                height: "data(height)",
                label: "data(label)",
                "text-valign": (ele: cytoscape.NodeSingular) => {
                    const data = ele.data() as transitionGraphWebViewApi.NodeData;
                    return data.labelvalign;
                },
                "text-halign": "center",
                "text-wrap": "wrap",
                shape: "round-rectangle",
                "border-style": "solid",
                color: browserStyle.getPropertyValue("--vscode-foreground"), // label color
                "background-color": browserStyle.getPropertyValue("--vscode-sideBar-border"),
                "border-color": browserStyle.getPropertyValue("--vscode-badge-foreground"),
                "border-width": "1.4",
                "font-family": browserStyle.getPropertyValue("--vscode-font-family"),
                "font-size": browserStyle.getPropertyValue("--vscode-font-size"),
                "font-weight": "normal",
            },
        },
        {
            selector: "edge",
            style: {
                label: (edge: cytoscape.EdgeSingular): string => {
                    switch (edgeLabelMode) {
                        case "none":
                            return "";
                        case "count":
                            return (edge.data() as transitionGraphWebViewApi.EdgeData).count?.toString() || "";
                        case "percentOfSource":
                            return (edge.data() as transitionGraphWebViewApi.EdgeData).percentOfSource || "";
                    }
                },
                "curve-style": "bezier",
                "target-arrow-shape": "triangle",
                "line-style": "solid",
                width: "1.4", // stroke thickness
                color: browserStyle.getPropertyValue("--vscode-foreground"), // label color
                "font-family": browserStyle.getPropertyValue("--vscode-font-family"),
                "font-size": browserStyle.getPropertyValue("--vscode-font-size"),
                "font-weight": "normal",
                "text-background-color": "rgba(0, 0, 0, 0)",
                "text-background-opacity": 0,
                "line-color": browserStyle.getPropertyValue("--vscode-activityBar-activeBorder"),
                "target-arrow-color": browserStyle.getPropertyValue("--vscode-activityBar-activeBorder"),
                "source-arrow-color": browserStyle.getPropertyValue("--vscode-activityBar-activeBorder"),
            },
        },
        {
            selector: "node:selected",
            style: {
                "border-color": browserStyle.getPropertyValue("--vscode-editorGutter-deletedBackground"),
            },
        },
        {
            selector: "edge:selected",
            style: {
                "line-color": browserStyle.getPropertyValue("--vscode-editorGutter-deletedBackground"),
                "target-arrow-color": browserStyle.getPropertyValue("--vscode-editorGutter-deletedBackground"),
                "source-arrow-color": browserStyle.getPropertyValue("--vscode-editorGutter-deletedBackground"),
            },
        },
        {
            selector: "node.mutation",
            style: {
                "border-color": "#00aaff",
                "border-style": "double",
                "border-width": 5,
            },
        },
        {
            selector: "node.impact",
            style: {
                "background-color": function (ele) {
                    const severity = ele.data().severity;
                    if (!severity) {
                        return "grey";
                    }

                    const notSevere: RgbColor = [209, 232, 44];
                    const severe: RgbColor = [212, 6, 6];

                    return rgbToCssColor(interpolateGradient(notSevere, severe, severity));
                },
                color: "black",
            },
        },
    ];
}

/**
 * Given a named layout type, return the cytoscape layout options we
 * should use when it is selected. If `nodeCoordinates` is given, it overrides
 * the layout selection.
 */
function layoutOptions(layout: LayoutType, nodeCoordinates?: cytoscape.NodePositionMap): cytoscape.LayoutOptions {
    if (nodeCoordinates != null) {
        return {
            name: "preset",
            animate: false,
            positions: nodeCoordinates,
        } as cytoscape.PresetLayoutOptions;
    }

    switch (layout) {
        case "breadthfirst":
            return {
                name: "breadthfirst",
                directed: true,
                grid: true,
                spacingFactor: 1,
            } as cytoscape.BreadthFirstLayoutOptions;

        case "cose-bilkent":
            return {
                name: "cose-bilkent",
                animate: false,
                nodeDimensionsIncludeLabels: true,
                nodeRepulsion: 1000000,
                numIter: 5000,
            } as cytoscapeExtTypes.CoseBilkentLayoutOptions;

        case "cose":
            return {
                name: "cose",
                animate: false,
                nodeDimensionsIncludeLabels: true,
                randomize: true,
                gravity: 1,
                nestingFactor: 1.2,
                nodeRepulsion: function () {
                    return 1000000;
                },
                nodeOverlap: 5,
                componentSpacing: 5,
                numIter: 5000,
            } as cytoscape.CoseLayoutOptions;

        case "concentric":
            return {
                name: "concentric",
                animate: false,
                nodeDimensionsIncludeLabels: true,
                randomize: true,
                gravity: 1,
                nestingFactor: 1.2,
                nodeRepulsion: function () {
                    return 1000000;
                },
                nodeOverlap: 5,
                componentSpacing: 5,
                numIter: 5000,
            } as cytoscape.ConcentricLayoutOptions;

        case "circle":
        case "grid":
            return {
                name: layout,
                spacingFactor: 0.5,
                padding: 1,
                animate: false,
            } as cytoscape.ShapedLayoutOptions;

        case "random":
            return {
                name: "random",
                spacingFactor: 0.5,
                padding: 1,
            } as cytoscape.ShapedLayoutOptions;
    }
}

/**
 * Select event handler for cytoscape. Further alters the selection depending on the
 * `selectionMode`. Relays updated selection information to the onSelection handler.
 */
let selecting = false;
function onSelect(
    evt: cytoscape.EventObject,
    selectionMode: GraphSelectionMode,
    onSelection: (selection: Selection) => void
) {
    if (selecting) {
        return;
    }
    selecting = true;
    const item = evt.target;
    switch (selectionMode) {
        case "manual":
            // cytoscape does all the work in manual mode
            break;
        case "bidirectional-neighbors":
            item.outgoers().union(item.incomers()).select();
            break;
        case "downstream-neighbors":
            item.outgoers().select();
            break;
        case "upstream-neighbors":
            item.incomers().select();
            break;
        case "causal-descendants":
            item.successors().select();
            break;
        case "causal-ancestors":
            item.predecessors().select();
            break;
    }

    onSelection({
        nodes: evt.cy
            ?.nodes()
            .filter((n) => n.selected())
            .map((n) => n.id()),
        edges: evt.cy
            ?.edges()
            .filter((e) => e.selected())
            .map((e) => e.id()),
    });

    selecting = false;
}

/**
 * Unselect event handler for cytoscape. Further alters the selection depending on the
 * `selectionMode`. Relays updated selection information to the onSelection handler.
 */
function onUnselect(
    evt: cytoscape.EventObject,
    selectionMode: GraphSelectionMode,
    onSelection: (selection: Selection) => void
) {
    switch (selectionMode) {
        case "manual":
            // cytoscape does all the work in manual mode
            break;
        default:
            evt.cy.elements().unselect();
            break;
    }

    onSelection({
        nodes: evt.cy
            .nodes()
            .filter((n) => n.selected())
            .map((n) => n.id()),
        edges: evt.cy
            .edges()
            .filter((e) => e.selected())
            .map((e) => e.id()),
    });
}

/**
 * Position event handler for cytoscape, called when a node position changes.
 * Extracts positions of all nodes, then relays the collection the parent via a callback.
 */
function onPosition(cy: cytoscape.Core, onNodeCoordinates: (nodeCoordinates: cytoscape.NodePositionMap) => void): void {
    const coords: cytoscape.NodePositionMap = {};
    cy.elements().forEach((ele) => {
        if (ele.isNode()) {
            coords[ele.id()] = ele.position();
        }
    });
    onNodeCoordinates(coords);
}

const txtCanvas = document.createElement("canvas");
const txtCtx = txtCanvas.getContext("2d");

// Copied from https://github.com/CoderAllan/vscode-dgmlviewer
// Copyright (c) 2021 Allan Simonsen
// See the license file third_party_licenses/LICENSE_vscode-dgmlviewr
export function calculateLabelHeightsAndWidths(nodeElements: cytoscape.NodeDefinition[]) {
    if (txtCtx == null) {
        throw new Error("Failed to freate canvas for text metrics");
    }
    nodeElements.forEach((node) => {
        if (node.data.label && node.data.label.length > 0) {
            let labelText = node.data.label;
            let metrics = txtCtx.measureText(labelText);
            node.data.height = (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) * 2;
            if (labelText.indexOf("\n") > -1) {
                // If the label text contains newlines,
                // then we should find the longest line of them in order to find the width of the node.
                let longestStringLength = 0;
                const lines = node.data.label.split("\n");
                lines.forEach((s: string) => {
                    if (s.length > longestStringLength) {
                        longestStringLength = s.length;
                        labelText = s;
                    }
                });
                metrics = txtCtx.measureText(labelText);
                node.data.height =
                    (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) * (lines.length + 2);
            }
            node.data.width = 4 + metrics.width * 1.5;
        }
    });
}

/**
 * An rgb color, defined as a triple of numbers ranging from 0-255
 */
type RgbColor = [number, number, number];

/**
 * Sample from a linear gradient between two colors. `position` is
 * between 0.0 and 1.0, and determines what point along the gradient
 * to sample. (0.0 is the start, 1.0 is the end)
 */
function interpolateGradient(startRgb: RgbColor, stopRgb: RgbColor, position: number): RgbColor {
    return [
        lerp(startRgb[0], stopRgb[0], position),
        lerp(startRgb[1], stopRgb[1], position),
        lerp(startRgb[2], stopRgb[2], position),
    ];
}

/**
 * Linear interpolation from `a` to `b`. `position` is a number
 * between 0.0 and 1.0 that controls how far along you are along the
 * interploation: `position = 0.0` returns `a,` while `position= 1.0`
 * returns b.
 */
function lerp(a: number, b: number, position: number) {
    return b * position + a * (1 - position);
}

/**
 * An explicit css-style rgb triple. This one uses commas because
 * cytoscape doesn't support the space-separated verison.
 */
type RgbCssColor = `rgb(${number}, ${number}, ${number})`;

/**
 * Format an rgb triple a css color, specifically one that works with
 * cytoscape.
 */
function rgbToCssColor(rgb: RgbColor): RgbCssColor {
    return `rgb(${Math.floor(rgb[0])}, ${Math.floor(rgb[1])}, ${Math.floor(rgb[2])})`;
}
