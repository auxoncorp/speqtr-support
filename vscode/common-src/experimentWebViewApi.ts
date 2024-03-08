export type WebViewMessage = VisualizeImpactScenarioCommand;

export interface VisualizeImpactScenarioCommand {
    command: "visualizeImpactScenario";
    args: ImpactScenario;
}

export interface ImpactScenario {
    scenarioName: string;
    mutations: MutationInfo[];
    impactedTimelines: TimelineInfo[];
}

export interface MutationInfo {
    mutationId: string;
    timelineId: string;
    timelineName: string;
    segmentId: SegmentId;
}

// This matches the one in the backend api
export interface SegmentId {
    workspace_version_id: string;
    rule_name: string;
    segment_name: string;
}

export interface TimelineInfo {
    timelineName: string;
    severity: number;
    events: string[];
    detailsHtml: string;
}
