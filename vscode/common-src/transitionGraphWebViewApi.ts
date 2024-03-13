import cytoscape from "cytoscape";

export type WebViewMessage = NodesAndEdgesCommand | ThemeChangedCommand;

export interface NodesAndEdgesCommand {
    command: "nodesAndEdges";
    nodes: cytoscape.NodeDefinition[];
    edges: cytoscape.EdgeDefinition[];
}

export interface ThemeChangedCommand {
    command: "themeChanged";
}

export type VsCodeMessage = RequestNodesAndEdgesCommand | SaveAsPngCommand | LogSelectedNodesCommand;

export interface RequestNodesAndEdgesCommand {
    command: "requestNodesAndEdges";
}

export interface SaveAsPngCommand {
    command: "saveAsPng";
    data: string;
}

export interface LogSelectedNodesCommand {
    command: "logSelectedNodes";
    thingsToLog: string[];
}

export interface NodeData extends cytoscape.NodeDataDefinition {
    label?: string;
    labelvalign: "top" | "center";
    filepath?: string;
    timeline?: string;
    timelineName?: string;
    eventName?: string;
    severity?: number;
    impactHtml?: string;
    count?: number;
}

export interface EdgeData extends cytoscape.EdgeDataDefinition {
    label?: string;
    hidden?: boolean;
    count?: number;
    percentOfSource?: string;
}
