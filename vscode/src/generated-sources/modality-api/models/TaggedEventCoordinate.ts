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
import type { EventCoordinate } from './EventCoordinate';
import {
    EventCoordinateFromJSON,
    EventCoordinateFromJSONTyped,
    EventCoordinateToJSON,
} from './EventCoordinate';

/**
 * 
 * @export
 * @interface TaggedEventCoordinate
 */
export interface TaggedEventCoordinate {
    /**
     * 
     * @type {EventCoordinate}
     * @memberof TaggedEventCoordinate
     */
    eventCoordinate?: EventCoordinate;
}

/**
 * Check if a given object implements the TaggedEventCoordinate interface.
 */
export function instanceOfTaggedEventCoordinate(value: object): boolean {
    let isInstance = true;
    isInstance = isInstance && "eventCoordinate" in value;

    return isInstance;
}

export function TaggedEventCoordinateFromJSON(json: any): TaggedEventCoordinate {
    return TaggedEventCoordinateFromJSONTyped(json, false);
}

export function TaggedEventCoordinateFromJSONTyped(json: any, ignoreDiscriminator: boolean): TaggedEventCoordinate {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'eventCoordinate': !exists(json, 'EventCoordinate') ? undefined : EventCoordinateFromJSON(json['EventCoordinate']),
    };
}

export function TaggedEventCoordinateToJSON(value?: TaggedEventCoordinate | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'EventCoordinate': EventCoordinateToJSON(value.eventCoordinate),
    };
}
