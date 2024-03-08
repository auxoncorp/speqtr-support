import * as vw from "vscode-webview";
import * as experimentWebViewApi from "../common-src/experimentWebViewApi";

const vscode: vw.WebviewApi<object> = acquireVsCodeApi();

function wrapElement(el: Element, outer_tag: string) {
    const outerEl = document.createElement(outer_tag);

    if (el.parentNode == null) {
        throw new Error("Cannot wrap element with no parent");
    }
    el.parentNode.insertBefore(outerEl, el);

    outerEl.appendChild(el);
    return outerEl;
}

function getExpectedAttr(el: Element, name: string): string | null {
    const attr = el.attributes.getNamedItem(name);
    if (attr == null) {
        console.warn(`Missing expected attribute ${name}`);
        return null;
    }
    return attr.nodeValue;
}

document.querySelectorAll("[data-scenario-name]").forEach((scenarioElement) => {
    const scenarioName = getExpectedAttr(scenarioElement, "data-scenario-name") || "Unnamed";

    // Gather the mutations, and timelines at which each occurred
    const mutations: experimentWebViewApi.MutationInfo[] = [];
    scenarioElement.querySelectorAll("[data-mutation]").forEach((mutationElement) => {
        const mutationId = getExpectedAttr(mutationElement, "data-mutation-id");
        const timelineId = getExpectedAttr(mutationElement, "data-timeline-id");
        const timelineName = getExpectedAttr(mutationElement, "data-timeline-name");
        const workspace_version_id = getExpectedAttr(mutationElement, "data-segment-workspace-version-id");
        const rule_name = getExpectedAttr(mutationElement, "data-segment-rule-name");
        const segment_name = getExpectedAttr(mutationElement, "data-segment-name");

        if (
            mutationId != null &&
            timelineId != null &&
            timelineName != null &&
            workspace_version_id != null &&
            rule_name != null &&
            segment_name != null
        ) {
            mutations.push({
                mutationId,
                timelineId,
                timelineName,
                segmentId: { workspace_version_id, rule_name, segment_name },
            });
        }
    });

    // Gather the impacted timelines, and what was impacted at each one
    const impactedTimelines: experimentWebViewApi.TimelineInfo[] = [];
    scenarioElement.querySelectorAll("[data-impact]").forEach((impactElement) => {
        const events: string[] = [];
        impactElement.querySelectorAll("[data-event-name]").forEach((eventElement) => {
            const eventName = getExpectedAttr(eventElement, "data-event-name");
            if (eventName != null) {
                events.push(eventName);
            }
        });

        const timelineName = getExpectedAttr(impactElement, "data-timeline-name");
        const severityString = getExpectedAttr(impactElement, "data-timeline-severity");
        const detailsHtml = impactElement.innerHTML;

        if (timelineName != null && severityString != null) {
            const severity = Number(severityString);
            if (!isNaN(severity)) {
                impactedTimelines.push({ timelineName, severity, events, detailsHtml });
            } else {
                console.warn("Could not parse data-timeline-severity as a number");
            }
        }
    });

    const scenarioTitleElement = scenarioElement.querySelector(".scenario-name");
    if (scenarioTitleElement != null) {
        const anchorElement = wrapElement(scenarioTitleElement, "a") as HTMLLinkElement;
        const args = { scenarioName, mutations, impactedTimelines };
        const msg: experimentWebViewApi.VisualizeImpactScenarioCommand = { command: "visualizeImpactScenario", args };
        anchorElement.onclick = () => vscode.postMessage(msg);
        anchorElement.href = "#";
    }
});
