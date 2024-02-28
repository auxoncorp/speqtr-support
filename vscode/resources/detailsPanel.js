(function () {
    const vscode = acquireVsCodeApi();

    const eventsHeader = document.getElementById("eventsHeader");
    const eventDetails = document.getElementById("eventDetails");
    const timelinesHeader = document.getElementById("timelinesHeader");
    const timelineDetails = document.getElementById("timelineDetails");
    const interactionsHeader = document.getElementById("interactionsHeader");
    const interactionDetails = document.getElementById("interactionDetails");
    const extraHtml = document.getElementById("extraHtml");

    window.addEventListener("message", (event) => {
        const message = event.data;

        if (message.events !== undefined && message.events.length > 0) {
            constructEvents(message.events);
        } else {
            clearEvents();
        }

        if (message.timelines !== undefined && message.timelines.length > 0) {
            constructTimelines(message.timelines);
        } else {
            clearTimelines();
        }

        if (message.interactions !== undefined && message.interactions.length > 0) {
            constructInteractions(message.interactions);
        } else {
            clearInteractions();
        }

        if (message.extraHtml !== undefined && message.extraHtml.length > 0) {
            constructExtraHtml(message.extraHtml);
        } else {
            clearExtraHtml();
        }
    });

    function clearEvents() {
        eventsHeader.hidden = true;
        eventsHeader.innerHTML = "";
        eventDetails.hidden = true;
        eventDetails.rowsData = [];
    }

    function constructEvents(events) {
        eventsHeader.innerHTML = "Events";
        eventsHeader.hidden = false;

        eventDetails.columnDefinitions = [
            { columnDataKey: "Col0", title: "Event Name" },
            { columnDataKey: "Col1", title: "Timeline Name" },
            { columnDataKey: "Col2", title: "Timeline ID" },
            { columnDataKey: "Col3", title: "Count" },
        ];
        eventDetails.rowsData = events.map((ev) => {
            return { Col0: ev.name, Col1: ev.timeline.name, Col2: ev.timeline.id, Col3: ev.count };
        });
        eventDetails.hidden = false;
    }

    function clearTimelines() {
        timelinesHeader.hidden = true;
        timelinesHeader.innerHTML = "";
        timelineDetails.hidden = true;
        timelineDetails.rowsData = [];
    }

    function constructTimelines(timelines) {
        timelinesHeader.innerHTML = "Timelines";
        timelinesHeader.hidden = false;

        timelineDetails.columnDefinitions = [
            { columnDataKey: "Col0", title: "Timeline Name" },
            { columnDataKey: "Col1", title: "Timeline ID" },
        ];
        timelineDetails.rowsData = timelines.map((tl) => {
            return { Col0: tl.name, Col1: tl.id };
        });
        timelineDetails.hidden = false;
    }

    function clearInteractions() {
        interactionsHeader.hidden = true;
        interactionsHeader.innerHTML = "";
        interactionDetails.hidden = true;
        interactionDetails.rowsData = [];
    }

    function constructInteractions(interactions) {
        interactionsHeader.innerHTML = "Interactions";
        interactionsHeader.hidden = false;

        const containsEvents = interactions.some(
            (it) => it.sourceEvent !== undefined || it.destinationEvent !== undefined
        );

        interactionDetails.columnDefinitions = [];
        if (containsEvents) {
            interactionDetails.columnDefinitions.push({ columnDataKey: "Col0", title: "Source Event Name" });
        }
        interactionDetails.columnDefinitions.push(
            { columnDataKey: "Col1", title: "Source Timeline Name" },
            { columnDataKey: "Col2", title: "Source Timeline ID" }
        );
        if (containsEvents) {
            interactionDetails.columnDefinitions.push({ columnDataKey: "Col3", title: "Destination Event Name" });
        }
        interactionDetails.columnDefinitions.push(
            { columnDataKey: "Col4", title: "Destination Timeline Name" },
            { columnDataKey: "Col5", title: "Destination Timeline ID" },
            { columnDataKey: "Col6", title: "Count" }
        );
        interactionDetails.rowsData = interactions.map((it) => {
            if (containsEvents) {
                return {
                    Col0: it.sourceEvent,
                    Col1: it.sourceTimeline.name,
                    Col2: it.sourceTimeline.id,
                    Col3: it.destinationEvent,
                    Col4: it.destinationTimeline.name,
                    Col5: it.destinationTimeline.id,
                    Col6: it.count,
                };
            } else {
                return {
                    Col1: it.sourceTimeline.name,
                    Col2: it.sourceTimeline.id,
                    Col4: it.destinationTimeline.name,
                    Col5: it.destinationTimeline.id,
                    Col6: it.count,
                };
            }
        });
        interactionDetails.hidden = false;
    }

    function clearExtraHtml() {
        extraHtml.innerHTML = "";
    }

    function constructExtraHtml(extraHtmlStrs) {
        var innerHtml = "";

        for (const extra of extraHtmlStrs) {
            innerHtml += extra;
        }

        extraHtml.innerHTML = innerHtml;

        // If there's a single top-level details node, make sure it's open
        const topLevelDetails = extraHtml.querySelectorAll(":scope > details");
        if (topLevelDetails.length == 1) {
            topLevelDetails[0].setAttribute("open", "");
        }
    }
})();
