import * as vw from "vscode-webview";
const vscode: vw.WebviewApi<object> = acquireVsCodeApi();

function wrapElement(el: Element, outer_tag: string) {
    const outerEl = document.createElement(outer_tag);
    el.parentNode.insertBefore(outerEl, el);
    outerEl.appendChild(el);
    return outerEl;
}

document.querySelectorAll("[data-scenario-name]").forEach((scenarioElement) => {
    const scenarioName = scenarioElement.attributes["data-scenario-name"].nodeValue;

    // Gather the mutations, and timelines at which each occurred
    const mutations = [];
    scenarioElement.querySelectorAll("[data-mutation]").forEach((mutationElement) => {
        const mutationId = mutationElement.attributes["data-mutation-id"].nodeValue;
        const timelineId = mutationElement.attributes["data-timeline-id"].nodeValue;
        const timelineName = mutationElement.attributes["data-timeline-name"].nodeValue;
        const segmentId = {
            workspace_version_id: mutationElement.attributes["data-segment-workspace-version-id"].nodeValue,
            rule_name: mutationElement.attributes["data-segment-rule-name"].nodeValue,
            segment_name: mutationElement.attributes["data-segment-name"].nodeValue,
        };
        mutations.push({ mutationId, timelineId, timelineName, segmentId });
    });

    // Gather the impacted timelines, and what was impacted at each one
    const impactedTimelines = [];
    scenarioElement.querySelectorAll("[data-impact]").forEach((impactElement) => {
        const timelineName = impactElement.attributes["data-timeline-name"].nodeValue;
        const severity = impactElement.attributes["data-timeline-severity"].nodeValue;
        const events = [];
        impactElement.querySelectorAll("[data-event-name]").forEach((eventElement) => {
            const eventName = eventElement.attributes["data-event-name"].nodeValue;
            events.push(eventName);
        });
        const detailsHtml = impactElement.innerHTML;
        impactedTimelines.push({ timelineName, severity, events, detailsHtml });
    });

    const scenarioTitleElement = scenarioElement.querySelector(".scenario-name");
    const anchorElement = wrapElement(scenarioTitleElement, "a") as HTMLLinkElement;

    const args = { scenarioName, mutations, impactedTimelines };
    const msg = { command: "visualizeImpactScenario", args };
    anchorElement.onclick = () => vscode.postMessage(msg);
    anchorElement.href = "#";
});
