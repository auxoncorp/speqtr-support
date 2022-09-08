import fetch from 'node-fetch';

export class ModalityApi {
    url: string;

    constructor(url) {
        this.url = url;
    }
    
    async listWorkspaces(): Promise<[WorkspaceName, WorkspaceVersionId][]> {
        const res = await this.request( 'workspace', 'list_workspaces', {});
        return res.workspaces;
    }

    async getWorkspaceDefinition(workspaceName: string): Promise<WorkspaceDefinition> {
        return await this.request(
            'workspace', 'get_workspace_definition',
            { 'workspace_name': workspaceName }
        );
    }

    async listWorkspaceSegments(id: WorkspaceVersionId): Promise<WorkspaceSegment[]> {
        let res = await this.request(
            'inspection', 'list_workspace_segments',
            { 'workspace_version_id': id }
        );
        return res['segments'];
    }

    async request(section: string, method: string, body: any): Promise<any> {
        const response = await fetch(`${this.url}/${section}/${method}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        const data = await response.json();
        if (data.Err !== undefined) {
            throw new Error(data.Err);
        } else {
            return data.Ok;
        }
    }
}

export type WorkspaceName = string;
export type WorkspaceVersionId = string;
export type UnstructuredTimelineFilter = string;
export type SegmentationRuleName = string;
export type WorkspaceSegmentName = string;
export type AttrVal = string | number | TaggedAttrVal;
export interface TaggedAttrVal { } // TODO

export interface WorkspaceDefinition {
    version: WorkspaceVersionId,
    content: WorkspaceVersionContent,
    metadata: VersionMetadata,
}

export interface VersionMetadata {
    created_at: String,
    created_by: String,
}

export interface WorkspaceVersionContent {
    attributes: Record<string, AttrVal>,
    timeline_filters: UnstructuredTimelineFilter[],
    segmentation_rules: Record<SegmentationRuleName, SegmentationRule>,
}

// TODO. Can we model this as a tagged union? serde-json does this funny external discriminator. 
export interface SegmentationRule { }

export interface WorkspaceSegment {
    name: WorkspaceSegmentName,
    parameters: WorkspaceSegmentParameters,
    rule_name: SegmentationRuleName,
    workspace_version_id: WorkspaceVersionId,
    latest_receive_time?: number // TODO is this the actual encoding?
}

// TODO
export interface WorkspaceSegmentParameters { }