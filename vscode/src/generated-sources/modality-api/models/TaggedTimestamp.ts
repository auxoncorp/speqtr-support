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
 * @interface TaggedTimestamp
 */
export interface TaggedTimestamp {
    /**
     * 
     * @type {number}
     * @memberof TaggedTimestamp
     */
    timestamp?: number;
}

/**
 * Check if a given object implements the TaggedTimestamp interface.
 */
export function instanceOfTaggedTimestamp(value: object): boolean {
    let isInstance = true;
    isInstance = isInstance && "timestamp" in value;

    return isInstance;
}

export function TaggedTimestampFromJSON(json: any): TaggedTimestamp {
    return TaggedTimestampFromJSONTyped(json, false);
}

export function TaggedTimestampFromJSONTyped(json: any, ignoreDiscriminator: boolean): TaggedTimestamp {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'timestamp': !exists(json, 'Timestamp') ? undefined : json['Timestamp'],
    };
}

export function TaggedTimestampToJSON(value?: TaggedTimestamp | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'Timestamp': value.timestamp,
    };
}
