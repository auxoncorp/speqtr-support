import * as gen from "../generated/src/modality-api";
import createClient from 'openapi-fetch';

// See https://github.com/ajaishankar/openapi-typescript-fetch#server-side-usage
import fetch, { Headers, Request, Response } from 'node-fetch'
if (!globalThis.fetch) {
    globalThis.fetch = fetch as any;
    globalThis.Headers = Headers as any;
    globalThis.Request = Request as any
    globalThis.Response = Response as any;
}

export type AttrVal = gen.components["schemas"]["AttrVal"];
export type GroupedGraph = gen.components["schemas"]["GroupedGraph"];
export type GroupedGraphEdge = gen.components["schemas"]["GroupedGraphEdge"];
export type GroupedGraphNode = gen.components["schemas"]["GroupedGraphNode"];
export type LogicalTime = gen.components["schemas"]["LogicalTime"];
export type Nanoseconds = gen.components["schemas"]["Nanoseconds"];
export type SegmentationRuleName = gen.components["schemas"]["SegmentationRuleName"];
export type Timeline = gen.components["schemas"]["Timeline"];
export type TimelineId = gen.components["schemas"]["TimelineId"];
export type TimelineOverview = gen.components["schemas"]["TimelineOverview"];
export type Workspace = gen.components["schemas"]["Workspace"];
export type WorkspaceSegmentId = gen.components["schemas"]["WorkspaceSegmentId"];
export type WorkspaceSegmentMetadata = gen.components["schemas"]["WorkspaceSegmentMetadata"];
export type WorkspaceSegmentName = gen.components["schemas"]["WorkspaceSegmentName"];
export type WorkspaceVersionId = gen.components["schemas"]["WorkspaceVersionId"];

type InternalClient = ReturnType<typeof createClient<gen.paths>>;

export class Client {
    client: InternalClient;

    constructor(baseUrl: string, userAuthToken: string) {
        if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }

        this.client = createClient<gen.paths>({
            baseUrl,

            // @ts-ignore The type for this appears to be correct for the browser, but ts can't seem to find
            // the base interface which allows 'headers' in the node.js context.
            headers: {
                'X-Auxon-Auth-Token': userAuthToken
            },
        });
    }

    workspaces(): WorkspacesClient {
        return new WorkspacesClient(this.client);
    }

    workspace(workspaceVersionId: WorkspaceVersionId): WorkspaceClient {
        return new WorkspaceClient(this.client, workspaceVersionId);
    }

    segment(segmentId: WorkspaceSegmentId): SegmentClient {
        return new SegmentClient(this.client, segmentId);
    }

    timelines(): TimelinesClient {
        return new TimelinesClient(this.client);
    }

    timeline(timelineId: TimelineId): TimelineClient {
        return new TimelineClient(this.client, timelineId);
    }   
}

export class WorkspacesClient {
    constructor(private readonly client: InternalClient) { }

    async list(): Promise<Workspace[]> {
        const res = await this.client
            .get("/v2/workspaces", {});
        return unwrapData(res);
    }
}

export class WorkspaceClient {
    constructor(
        private readonly client: InternalClient,
        private readonly workspaceVersionId: WorkspaceVersionId)
    { }

    async segments(): Promise<WorkspaceSegmentMetadata[]> {
        const res = await this.client.get(
            "/v2/workspaces/{workspace_version_id}/segments",
            { params: { path: { workspace_version_id: this.workspaceVersionId } } });
        return unwrapData(res);
    }

    async timelines(): Promise<TimelineOverview[]> {
        const res = await this.client.get(
            "/v2/workspaces/{workspace_version_id}/timelines",
            { params: { path: { workspace_version_id: this.workspaceVersionId } } });
        return unwrapData(res);
    }
}

export class SegmentClient {
    constructor(
        private readonly client: InternalClient,
        private readonly segmentId: WorkspaceSegmentId)
    { }

    async timelines(): Promise<TimelineOverview[]> {
        const res = await this.client
            .get("/v2/workspaces/{workspace_version_id}/segments/{rule_name}/{segment_name}/timelines",
                { params: { path: this.segmentId } });
        return unwrapData(res);
    }

    async groupedGraph(group_by: string[]): Promise<GroupedGraph> {
        const res = await this.client.get(
            "/v2/workspaces/{workspace_version_id}/segments/{rule_name}/{segment_name}/grouped_graph",
            { params: { path: this.segmentId, query: { group_by } } });
        return unwrapData(res);
    }
}

export class TimelinesClient {
    constructor(private readonly client: InternalClient) { }

    async groupedGraph(timeline_id: string[], group_by: string[]): Promise<GroupedGraph> {
        const timeline_id_query = timeline_id.map((tid) => ["timeline_id", tid]);
        const group_by_query = group_by.map((gb) => ["group_by", gb]);
        const query = timeline_id_query.concat(group_by_query);

        const res = await this.client.get(
            "/v2/timelines/grouped_graph",
            { params: { query: query as any } });
        return unwrapData(res);
    }
    
}

export class TimelineClient {
    constructor(
        private readonly client: InternalClient,
        private readonly timelineId: TimelineId)
    { }

    async get(): Promise<Timeline> {
        const res = await this.client.get(
            "/v2/timelines/{timeline_id}",
            { params: { path: { timeline_id: this.timelineId } } });
        return unwrapData(res);
    }
}

/**
 * Convert a repsonse to just the data; if it's an error, throw the error. 
 */
function unwrapData<T>(res: { data: T, error?: never} | { data?: never, error: any}): T {
    if (res.error) {
        throw new Error(res.error);
    } else {
        return res.data;
    }
}

