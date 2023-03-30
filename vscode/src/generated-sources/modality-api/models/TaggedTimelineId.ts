/* tslint:disable */
/* eslint-disable */
/**
 * Modality REST API
 * Modality REST API
 *
 * The version of the OpenAPI document: 2.0
 * Contact: support@auxon.com
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { exists, mapValues } from '../runtime';
/**
 * 
 * @export
 * @interface TaggedTimelineId
 */
export interface TaggedTimelineId {
    /**
     * 
     * @type {string}
     * @memberof TaggedTimelineId
     */
    timelineId?: string;
}

/**
 * Check if a given object implements the TaggedTimelineId interface.
 */
export function instanceOfTaggedTimelineId(value: object): boolean {
    let isInstance = true;
    isInstance = isInstance && "timelineId" in value;

    return isInstance;
}

export function TaggedTimelineIdFromJSON(json: any): TaggedTimelineId {
    return TaggedTimelineIdFromJSONTyped(json, false);
}

export function TaggedTimelineIdFromJSONTyped(json: any, ignoreDiscriminator: boolean): TaggedTimelineId {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'timelineId': !exists(json, 'TimelineId') ? undefined : json['TimelineId'],
    };
}

export function TaggedTimelineIdToJSON(value?: TaggedTimelineId | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'TimelineId': value.timelineId,
    };
}

