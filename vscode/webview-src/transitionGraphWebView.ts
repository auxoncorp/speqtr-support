import * as vw from "vscode-webview";
import cytoscape from "cytoscape";
import $ from "jquery";

import * as wvtk from "@vscode/webview-ui-toolkit";
wvtk.provideVSCodeDesignSystem()
    .register(wvtk.vsCodeButton())
    .register(wvtk.vsCodeDropdown())
    .register(wvtk.vsCodeOption())
    .register(wvtk.vsCodeProgressRing());

import * as cytoscapeExtTypes from "./cytoscapeExtTypes";
import * as transitionGraphWebViewApi from "../common-src/transitionGraphWebViewApi";
import contextMenus from "cytoscape-context-menus";
import coseBilkent from "cytoscape-cose-bilkent";
cytoscape.use(coseBilkent);
cytoscape.use(contextMenus);

const defaultZoom = 1.25;

const loadingDiv = document.getElementById("loading");
const cyContainerDiv = document.getElementById("cy");
const layoutDropdown = document.getElementById("layoutDropdown");
const modeDropdown = document.getElementById("modeDropdown");
const toolbarSave = document.getElementById("toolbarSave");
const toolbarRefresh = document.getElementById("toolbarRefresh");
const txtCanvas = document.createElement("canvas");
const txtCtx = txtCanvas.getContext("2d");
const detailsGrid = document.getElementById("detailsGrid");
const impactDetailsContainer = document.getElementById("impactDetailsContainer");
$(impactDetailsContainer).hide();

const vscode: vw.WebviewApi<PersistentState> = acquireVsCodeApi();

// The cytoscape interface
let cy: cytoscape.Core = undefined;

const validLayouts = ["cose-bilkent", "breadthfirst", "cose", "circle", "grid"];
type LayoutType = (typeof validLayouts)[number];
function isLayout(s: string): s is LayoutType {
    return !!validLayouts.find((l) => s === l);
}

const validSelectionModes = [
    "manual",
    "bidirectional-neighbors",
    "upstream-neighbors",
    "downstream-neighbors",
    "causal-descendants",
    "causal-ancestors",
];
type SelectionMode = (typeof validSelectionModes)[number];
function isSelectionMode(s: string): s is SelectionMode {
    return !!validSelectionModes.find((m) => s === m);
}

interface PersistentState {
    nodeElements: cytoscape.NodeDefinition[];
    edgeElements: cytoscape.EdgeDefinition[];
    nodeCoordinates: cytoscape.NodePositionMap;
    selectedLayout: LayoutType;
    selectionMode: SelectionMode;
    loading: boolean;
    zoom?: number;
    pan?: cytoscape.Position;
}

let persistentState: PersistentState = {
    nodeElements: [],
    edgeElements: [],
    nodeCoordinates: {},
    selectedLayout: "cose-bilkent",
    selectionMode: "manual",
    loading: true,
    zoom: undefined,
    pan: undefined,
};

loadPersistentState();
updateLayoutDropdown();
constructGraph();

function updateLoadingUI() {
    if (persistentState.loading) {
        $(cyContainerDiv).hide();
        $(loadingDiv).show();
    } else {
        $(loadingDiv).hide();
        $(cyContainerDiv).show();
    }
}

window.addEventListener("message", (event: MessageEvent<transitionGraphWebViewApi.WebViewMessage>) => {
    const message = event.data;
    switch (message.command) {
        case "nodesAndEdges":
            persistentState.nodeElements = message.nodes;
            persistentState.edgeElements = message.edges;
            persistentState.loading = false;
            savePersistentState();

            updateLoadingUI();
            constructGraph();
            break;
        case "themeChanged":
            constructGraph();
            break;
    }
});

window.onload = function () {
    updateLoadingUI();
};

window.addEventListener("resize", () => {
    resizeContainer(window.innerHeight);
});

layoutDropdown.addEventListener("change", () => {
    const newLayout = (document.getElementById("layoutDropdown") as HTMLInputElement).value;
    if (isLayout(newLayout)) {
        changeLayout(newLayout);
    } else {
        console.error(`Invalid layout name: ${newLayout}`);
    }
});

modeDropdown.addEventListener("change", () => {
    const newMode = (document.getElementById("modeDropdown") as HTMLInputElement).value;
    if (isSelectionMode(newMode)) {
        changeSelectionMode(newMode);
    } else {
        console.error(`Invalid selection mode: ${newMode}`);
    }
});

toolbarSave.addEventListener("click", savePng);
toolbarRefresh.addEventListener("click", refresh);

function resizeContainer(newContainerHeight: number) {
    cyContainerDiv.style.height = newContainerHeight.toString();
}

function storeCoordinates(cy: cytoscape.Core) {
    persistentState.nodeCoordinates = {};
    cy.elements().forEach((ele) => {
        if (ele.isNode()) {
            persistentState.nodeCoordinates[ele.id()] = {
                x: ele.position("x"),
                y: ele.position("y"),
            };
        }
    });
    savePersistentState();
}

function savePersistentState() {
    vscode.setState(persistentState);
}

function loadPersistentState() {
    const state = vscode.getState();
    if (state) {
        persistentState = state;
        updateLoadingUI();
    }
}

function updateLayoutDropdown() {
    for (let i, j = 0; (i = layoutDropdown.children[j]); j++) {
        i.removeAttribute("class");
        if (i.getAttribute("value") === persistentState.selectedLayout) {
            i.setAttribute("class", "selected");
            layoutDropdown.setAttribute("activedescendant", `option-${j + 1}`);
            layoutDropdown.setAttribute("current-value", i.getAttribute("value"));
            break;
        }
    }
}

function savePng() {
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

function refresh() {
    persistentState.nodeCoordinates = {};
    persistentState.pan = undefined;
    persistentState.zoom = undefined;
    constructGraph();
}

function changeLayout(newLayout: LayoutType) {
    if (newLayout != persistentState.selectedLayout) {
        persistentState.selectedLayout = newLayout;
        persistentState.nodeCoordinates = {};
        savePersistentState();
        constructGraph();
    }
}

function changeSelectionMode(newMode) {
    if (newMode != persistentState.selectionMode) {
        persistentState.selectionMode = newMode;
        if (cy) {
            cy.elements().unselect();
            cy.elements().removeClass("selected");
        }
    }
}

function updateSelectionDetails() {
    const selectedNodes: transitionGraphWebViewApi.NodeData[] = cy
        .nodes()
        .filter((n) => n.hasClass("selected"))
        .map((n) => n.data() as transitionGraphWebViewApi.NodeData);

    const selectedEdges = cy
        .edges()
        .filter((e) => e.hasClass("selected"))
        .map((e) => e.data() as transitionGraphWebViewApi.EdgeData);

    let newEls = [];

    const nodesWithEventName = selectedNodes.filter((nodeData) => nodeData.eventName !== undefined);
    if (nodesWithEventName?.length > 0) {
        newEls = newEls.concat(eventDetailsRows(nodesWithEventName));
    }

    const nodesWithTimelineId = selectedNodes.filter((nodeData) => nodeData.timeline !== undefined);
    if (nodesWithTimelineId?.length > 0) {
        newEls = newEls.concat(timelineDetailsRows(nodesWithTimelineId));
    }

    if (selectedEdges?.length > 0) {
        newEls = newEls.concat(interactionDetailsRows(selectedEdges));
    }

    detailsGrid.innerText = "";
    if (newEls.length > 0) {
        for (const el of newEls) {
            el.appendTo(detailsGrid);
        }
        $(detailsGrid).show();
    } else {
        $(detailsGrid).hide();
    }

    const nodesWithImpactHtml = selectedNodes.filter((nodeData) => nodeData.impactHtml !== undefined);
    if (nodesWithImpactHtml.length > 0) {
        impactDetailsContainer.innerText = "";

        let innerHTML = "";
        for (const n of nodesWithImpactHtml) {
            innerHTML += n.impactHtml;
        }

        impactDetailsContainer.innerHTML = innerHTML;

        // If there's a single top-level details node, make sure it's open
        const topLevelDetails = impactDetailsContainer.querySelectorAll(":scope > details");
        if (topLevelDetails.length == 1) {
            topLevelDetails[0].setAttribute("open", "");
        }

        $(impactDetailsContainer).show();
    } else {
        $(impactDetailsContainer).hide();
    }
}

function eventDetailsRows(nodesWithEventName: transitionGraphWebViewApi.NodeData[]) {
    const newEls = [];

    const header = $("<div/>", { class: "vsc-grid-row header", style: "grid-column: span 3" });
    $("<div/>", { class: "vsc-grid-cell column-header", text: "Event Name" }).appendTo(header);
    $("<div/>", { class: "vsc-grid-cell column-header", text: "Count" }).appendTo(header);
    $("<div/>", { class: "vsc-grid-cell column-header", text: "" }).appendTo(header);
    newEls.push(header);

    for (const n of nodesWithEventName) {
        const row = $("<div/>", { class: "vsc-grid-row", style: "grid-column: span 3" });
        $("<div/>", { class: "vsc-grid-cell", text: cellTextForNode(n) }).appendTo(row);
        $("<div/>", { class: "vsc-grid-cell", style: "grid-column: span 2", text: n.count?.toString() }).appendTo(row);
        newEls.push(row);
    }

    return newEls;
}

function timelineDetailsRows(nodesWithTimelineId: transitionGraphWebViewApi.NodeData[]) {
    const newEls = [];

    const header = $("<div/>", { class: "vsc-grid-row header", style: "grid-column: span 3" });
    $("<div/>", { class: "vsc-grid-cell column-header", text: "Timeline Name" }).appendTo(header);
    $("<div/>", { class: "vsc-grid-cell column-header", text: "Timeline Id" }).appendTo(header);
    newEls.push(header);

    const unique = [];
    for (const n of nodesWithTimelineId) {
        if (!unique.some((u) => u.timeline == n.timeline && u.timelineId == n.timelineId)) {
            unique.push(n);
        }
    }

    for (const n of unique) {
        const row = $("<div/>", { class: "vsc-grid-row", style: "grid-column: span 3" });
        $("<div/>", { class: "vsc-grid-cell", text: n.timelineName }).appendTo(row);
        $("<div/>", {
            class: "vsc-grid-cell",
            style: "grid-column: span 2",
            text: formatTimelineId(n.timeline),
        }).appendTo(row);
        newEls.push(row);
    }

    return newEls;
}

function interactionDetailsRows(selectedEdges: transitionGraphWebViewApi.EdgeData[]) {
    const newEls = [];

    const header = $("<div/>", { class: "vsc-grid-row header", style: "grid-column: span 3" });
    $("<div/>", { class: "vsc-grid-cell column-header", text: "Interaction Source" }).appendTo(header);
    $("<div/>", { class: "vsc-grid-cell column-header", text: "Count" }).appendTo(header);
    $("<div/>", { class: "vsc-grid-cell column-header", text: "Destination" }).appendTo(header);
    newEls.push(header);

    for (const e of selectedEdges) {
        const sourceNode = cy.getElementById(e.source)?.data();
        const destNode = cy.getElementById(e.target)?.data();
        if (!sourceNode || !destNode) {
            continue;
        }

        const row = $("<div/>", { class: "vsc-grid-row", style: "grid-column: span 3" });
        $("<div/>", { class: "vsc-grid-cell", text: cellTextForNode(sourceNode) }).appendTo(row);
        $("<div/>", { class: "vsc-grid-cell", text: e.count?.toString() }).appendTo(row);
        $("<div/>", { class: "vsc-grid-cell", text: cellTextForNode(destNode) }).appendTo(row);
        newEls.push(row);
    }

    return newEls;
}

function cellTextForNode(node: transitionGraphWebViewApi.NodeData) {
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

function formatTimelineId(timelineId: string) {
    let s = timelineId.replaceAll("-", "");
    if (!s.startsWith("%")) {
        s = "%" + s;
    }
    return s;
}

function cytoscapeStyle(): cytoscape.Stylesheet[] {
    // Get the doc styles to access vscode theme colors
    const style = getComputedStyle(document.body);

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
                color: style.getPropertyValue("--vscode-foreground"), // label color
                "background-color": style.getPropertyValue("--vscode-sideBar-border"),
                "border-color": style.getPropertyValue("--vscode-badge-foreground"),
                "border-width": "1.4",
                "font-family": style.getPropertyValue("--vscode-font-family"),
                "font-size": style.getPropertyValue("--vscode-font-size"),
                "font-weight": "normal",
            },
        },
        {
            selector: "edge",
            style: {
                label: "data(label)",
                "curve-style": "bezier",
                "target-arrow-shape": "triangle",
                "line-style": "solid",
                width: "1.4", // stroke thickness
                color: style.getPropertyValue("--vscode-foreground"), // label color
                "font-family": style.getPropertyValue("--vscode-font-family"),
                "font-size": style.getPropertyValue("--vscode-font-size"),
                "font-weight": "normal",
                "text-background-color": "rgba(0, 0, 0, 0)",
                "text-background-opacity": 0,
                "line-color": style.getPropertyValue("--vscode-activityBar-activeBorder"),
                "target-arrow-color": style.getPropertyValue("--vscode-activityBar-activeBorder"),
                "source-arrow-color": style.getPropertyValue("--vscode-activityBar-activeBorder"),
            },
        },
        {
            selector: "node.selected",
            style: {
                "border-color": style.getPropertyValue("--vscode-editorGutter-deletedBackground"),
            },
        },
        {
            selector: "edge.selected",
            style: {
                "line-color": style.getPropertyValue("--vscode-editorGutter-deletedBackground"),
                "target-arrow-color": style.getPropertyValue("--vscode-editorGutter-deletedBackground"),
                "source-arrow-color": style.getPropertyValue("--vscode-editorGutter-deletedBackground"),
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

function constructGraph() {
    if (persistentState.nodeElements.length == 0) {
        // Do nothing until we've gotten data from the vscode
        // extension
        return;
    }

    calculateLabelHeightsAndWidths();

    let layout: cytoscape.LayoutOptions = undefined;
    if (Object.keys(persistentState.nodeCoordinates).length > 0) {
        const l: cytoscape.PresetLayoutOptions = {
            name: "preset",
            animate: false,
            positions: persistentState.nodeCoordinates,
        };
        layout = l;
    } else if (persistentState.selectedLayout === "breadthfirst") {
        const l: cytoscape.BreadthFirstLayoutOptions = {
            name: "breadthfirst",
            directed: true,
            grid: true,
            spacingFactor: 1,
        };
        layout = l;
    } else if (persistentState.selectedLayout === "cose-bilkent") {
        const l: cytoscapeExtTypes.CoseBilkentLayoutOptions = {
            name: "cose-bilkent",
            animate: false,
            nodeDimensionsIncludeLabels: true,
            nodeRepulsion: 1000000,
            numIter: 5000,
        };
        layout = l;
    } else if (persistentState.selectedLayout === "cose") {
        const l: cytoscape.CoseLayoutOptions = {
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
        };
        layout = l;
    } else if (persistentState.selectedLayout === "circle" || persistentState.selectedLayout === "grid") {
        const l: cytoscape.ShapedLayoutOptions = {
            name: persistentState.selectedLayout,
            spacingFactor: 0.5,
            padding: 1,
        };
        layout = l;
    }

    cy = cytoscape({
        container: cyContainerDiv,
        style: cytoscapeStyle(),
        elements: {
            nodes: persistentState.nodeElements,
            edges: persistentState.edgeElements,
        },
        layout,
        pan: { x: 0, y: 0 },
        minZoom: 0,
        maxZoom: 4,
        wheelSensitivity: 0.1,
    });

    storeCoordinates(cy);

    if (persistentState.zoom !== undefined) {
        cy.zoom(persistentState.zoom);
    } else {
        cy.zoom(defaultZoom);
    }

    if (persistentState.pan !== undefined) {
        cy.pan(persistentState.pan);
    } else {
        cy.center();
        cy.fit();
    }

    cy.on("zoom", function () {
        persistentState.zoom = cy.zoom();
        savePersistentState();
    });

    cy.on("pan", function () {
        persistentState.pan = cy.pan();
        savePersistentState();
    });

    cy.on("position", function (_) {
        storeCoordinates(cy);
    });

    cy.on("select", function (evt: cytoscape.EventObject) {
        const item = evt.target;
        switch (persistentState.selectionMode) {
            case "manual":
                if (item.isNode() || item.isEdge()) {
                    item.addClass("selected");
                }
                break;
            case "bidirectional-neighbors":
                item.addClass("selected").outgoers().union(item.incomers()).addClass("selected");
                break;
            case "downstream-neighbors":
                item.addClass("selected").outgoers().addClass("selected");
                break;
            case "upstream-neighbors":
                item.addClass("selected").incomers().addClass("selected");
                break;
            case "causal-descendants":
                item.addClass("selected").successors().addClass("selected");
                break;
            case "causal-ancestors":
                item.addClass("selected").predecessors().addClass("selected");
                break;
        }
        updateSelectionDetails();
    });

    cy.on("unselect", function (evt: cytoscape.EventObject) {
        const item = evt.target;
        switch (persistentState.selectionMode) {
            case "manual":
                if (item.isNode() || item.isEdge()) {
                    item.removeClass("selected");
                }
                break;
            default:
                cy.elements().removeClass("selected");
                break;
        }
        updateSelectionDetails();
    });

    const contextMenu = cy.contextMenus({
        menuItems: [
            {
                id: "log-selected-nodes",
                content: "Log Selected Nodes",
                selector: "node, edge",
                coreAsWell: false,
                show: false,
                onClickFunction: function () {
                    const thingsToLog = cy
                        .nodes()
                        .filter((n) => n.hasClass("selected"))
                        .map((n) => thingToLogForNodeData(n.data()))
                        .filter((thingToLog) => !!thingToLog);
                    const msg: transitionGraphWebViewApi.LogSelectedNodesCommand = {
                        command: "logSelectedNodes",
                        thingsToLog,
                    };
                    vscode.postMessage(msg);
                },
            },
        ],
    });

    cy.on("cxttap", function () {
        const numSelectedNodes = cy
            .nodes()
            .filter((n) => n.hasClass("selected") && n.data("timeline") !== undefined).length;
        if (numSelectedNodes > 0) {
            contextMenu.showMenuItem("log-selected-nodes");
        } else {
            contextMenu.hideMenuItem("log-selected-nodes");
        }
    });
}

// Copied from https://github.com/CoderAllan/vscode-dgmlviewer
// Copyright (c) 2021 Allan Simonsen
// See the license file third_party_licenses/LICENSE_vscode-dgmlviewr
function calculateLabelHeightsAndWidths() {
    persistentState.nodeElements.forEach((node) => {
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

type RgbColor = [number, number, number];
function interpolateGradient(startRgb: RgbColor, stopRgb: RgbColor, position: number): RgbColor {
    return [
        lerp(startRgb[0], stopRgb[0], position),
        lerp(startRgb[1], stopRgb[1], position),
        lerp(startRgb[2], stopRgb[2], position),
    ];
}

function lerp(a: number, b: number, position: number) {
    return b * position + a * (1 - position);
}

type RgbCssColor = `rgb(${number}, ${number}, ${number})`;
function rgbToCssColor(rgb: RgbColor): RgbCssColor {
    return `rgb(${Math.floor(rgb[0])}, ${Math.floor(rgb[1])}, ${Math.floor(rgb[2])})`;
}

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
