const vscode = acquireVsCodeApi();

const defaultZoom = 1.25;
const cyContainerDiv = document.getElementById("cy");
const layoutDropdown = document.getElementById("layoutDropdown");
const modeDropdown = document.getElementById("modeDropdown");
const toolbarSave = document.getElementById("toolbarSave");
const toolbarRefresh = document.getElementById("toolbarRefresh");
const txtCanvas = document.createElement("canvas");
const txtCtx = txtCanvas.getContext("2d");

var nodeElements = [];
var edgeElements = [];
var nodeCoordinates = [];
var cy = undefined;
var loadedLayoutFromState = undefined;
var selectedLayout = "cose-bilkent";
var selectionMode = "causal-descendants";

loadPersistentState();
updateLayoutDropdown();
if (loadedLayoutFromState !== undefined) {
    constructGraph();
}

setInterval(() => {
    savePersistentState();
}, 1000);

window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.command) {
        case "nodesAndEdges":
            nodeElements = message.nodes;
            edgeElements = message.edges;
            constructGraph();
            break;
    }
});

// Request initial data from the extension when loaded
window.onload = function () {
    if (nodeElements.length == 0 && edgeElements.length == 0) {
        vscode.postMessage({ command: "requestNodesAndEdges", value: {} });
    }
};
window.addEventListener("resize", () => {
    resizeContainer(window.innerHeight);
});

layoutDropdown.addEventListener("change", () => {
    var newLayout = document.getElementById("layoutDropdown").value;
    changeLayout(newLayout);
});
modeDropdown.addEventListener("change", () => {
    var newMode = document.getElementById("modeDropdown").value;
    changeSelectionMode(newMode);
});
toolbarSave.addEventListener("click", savePng);
toolbarRefresh.addEventListener("click", refresh);

function resizeContainer(newContainerHeight) {
    cyContainerDiv.style.height = newContainerHeight;
    if (cy !== undefined) {
        cy.resize();
        cy.fit();
    }
}

function storeCoordinates(cy) {
    cy.elements().forEach((ele) => {
        if (ele.isNode()) {
            nodeCoordinates[ele.id()] = {
                x: ele.position("x"),
                y: ele.position("y"),
            };
        }
    });
}

function savePersistentState() {
    vscode.setState({ nodeElements, edgeElements, nodeCoordinates, layout: selectedLayout });
}

function loadPersistentState() {
    const state = vscode.getState();
    if (state) {
        nodeElements = state.nodeElements;
        edgeElements = state.edgeElements;
        nodeCoordinates = state.nodeCoordinates;
        loadedLayoutFromState = state.layout;
    }
}

function updateLayoutDropdown() {
    const layoutValue = loadedLayoutFromState ? loadedLayoutFromState : selectedLayout;
    for (var i, j = 0; (i = layoutDropdown.children[j]); j++) {
        i.removeAttribute("class");
        if (i.getAttribute("value") === layoutValue) {
            i.setAttribute("class", "selected");
            layoutDropdown.setAttribute("activedescendant", `option-${j + 1}`);
            layoutDropdown.setAttribute("current-value", i.getAttribute("value"));
            break;
        }
    }
}

function savePng() {
    const options = {
        output: "base64uri",
        bg: "transparent",
        full: true,
    };
    const cyPng = cy.png(options);
    vscode.postMessage({
        command: "saveAsPng",
        data: cyPng,
    });
}

function refresh() {
    constructGraph();
}

function changeLayout(newLayout) {
    if (newLayout != selectedLayout) {
        selectedLayout = newLayout;
        constructGraph();
    }
}

function changeSelectionMode(newMode) {
    if (newMode != selectionMode) {
        selectionMode = newMode;
        if (cy) {
            cy.elements().unselect();
            cy.elements().removeClass("selected");
        }
    }
}

function constructGraph() {
    if (nodeElements.length == 0 && edgeElements.length == 0) {
        // Do nothing until we've gotten data from the vscode
        // extension
        return;
    }

    calculateLabelHeightsAndWidths();

    let layoutOptions = {
        name: selectedLayout,
    };

    if (loadedLayoutFromState !== undefined) {
        loadedLayoutFromState = undefined;
        layoutOptions = {
            name: "preset",
            animate: false,
            positions: function (node) {
                return nodeCoordinates[node.id()];
            },
        };
    } else if (layoutOptions.name === "breadthfirst") {
        layoutOptions = {
            name: layoutOptions.name,
            directed: true,
            grid: true,
            spacingFactor: 1,
        };
    } else if (layoutOptions.name === "cose-bilkent") {
        layoutOptions = {
            name: layoutOptions.name,
            animate: false,
            nodeDimensionsIncludeLabels: true,
            nodeRepulsion: 1000000,
            nodeOverlap: 5,
            componentSpacing: 5,
            numIter: 5000,
        };
    } else if (layoutOptions.name === "cose") {
        layoutOptions = {
            name: layoutOptions.name,
            animate: false,
            nodeDimensionsIncludeLabels: true,
            randomize: true,
            gravity: 1,
            nestingFactor: 1.2,
            nodeRepulsion: function (node) {
                return 1000000;
            },
            nodeOverlap: 5,
            componentSpacing: 5,
            numIter: 5000,
        };
    } else if (layoutOptions.name === "circle" || layoutOptions.name === "grid") {
        layoutOptions = {
            name: layoutOptions.name,
            spacingFactor: 0.5,
            padding: 1,
        };
    }

    // Get the doc styles to access vscode theme colors
    var style = getComputedStyle(document.body);

    cy = cytoscape({
        container: cyContainerDiv,
        style: [
            {
                selector: "node",
                style: {
                    width: "data(width)",
                    height: "data(height)",
                    label: "data(label)",
                    "text-valign": "data(labelvalign)",
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
        ],
        elements: {
            nodes: nodeElements,
            edges: edgeElements,
        },
        layout: layoutOptions,
        pan: {
            x: 0,
            y: 0,
        },
        minZoom: 0,
        maxZoom: 4,
        wheelSensitivity: 0.1,
    });

    storeCoordinates(cy);

    cy.zoom(defaultZoom);
    cy.center();
    cy.fit();

    cy.on("select", function (evt) {
        let item = evt.target;
        switch (selectionMode) {
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
    });
    cy.on("unselect", function (evt) {
        let item = evt.target;
        switch (selectionMode) {
            case "manual":
                if (item.isNode() || item.isEdge()) {
                    item.removeClass("selected");
                }
                break;
            default:
                cy.elements().removeClass("selected");
                break;
        }
    });
}

// Copied from https://github.com/CoderAllan/vscode-dgmlviewer
// Copyright (c) 2021 Allan Simonsen
// See the license file third_party_licenses/LICENSE_vscode-dgmlviewr
function calculateLabelHeightsAndWidths() {
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
                lines.forEach((s) => {
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
