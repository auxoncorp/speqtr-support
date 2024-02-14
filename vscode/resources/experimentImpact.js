(function () {
    const vscode = acquireVsCodeApi();

    function wrapElement(el, outer_tag) {
        const outerEl = document.createElement(outer_tag);
        el.parentNode.insertBefore(outerEl, el);
        outerEl.appendChild(el);
        return outerEl;
    }

    for (const scenarioElement of document.querySelectorAll("[data-scenario-name]")) {
        const scenarioName = scenarioElement.attributes["data-scenario-name"].nodeValue;

        // Gather the mutations, and timelines at which each occurred
        const mutations = [];
        for (const mutationElement of scenarioElement.querySelectorAll("[data-mutation]")) {
            const mutationId = mutationElement.attributes["data-mutation-id"].nodeValue;
            const timelineId = mutationElement.attributes["data-timeline-id"].nodeValue;
            const timelineName = mutationElement.attributes["data-timeline-name"].nodeValue;
            const segmentId = {
                workspace_version_id: mutationElement.attributes["data-segment-workspace-version-id"].nodeValue,
                rule_name: mutationElement.attributes["data-segment-rule-name"].nodeValue,
                segment_name: mutationElement.attributes["data-segment-name"].nodeValue,
            };
            mutations.push({ mutationId, timelineId, timelineName, segmentId });
        }

        // Gather the impacted timelines, and what was impacted at each one
        const impactedTimelines = [];
        for (const impactElement of scenarioElement.querySelectorAll("[data-impact]")) {
            const timelineName = impactElement.attributes["data-timeline-name"].nodeValue;
            const severity = impactElement.attributes["data-timeline-severity"].nodeValue;
            const events = [];
            for (const eventElement of impactElement.querySelectorAll("[data-event-name]")) {
                const eventName = eventElement.attributes["data-event-name"].nodeValue;
                events.push(eventName);
            }
            impactedTimelines.push({ timelineName, severity, events });
        }

        const scenarioTitleElement = scenarioElement.querySelector(".scenario-name");
        const anchorElement = wrapElement(scenarioTitleElement, "a");

        const args = { scenarioName, mutations, impactedTimelines };
        const msg = { command: "visualizeImpactScenario", args };
        anchorElement.href = "#";
        anchorElement.onclick = () => vscode.postMessage(msg);
    }
})();
