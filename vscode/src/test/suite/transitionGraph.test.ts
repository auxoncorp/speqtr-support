import * as assert from "assert";
import { after } from "mocha";

import * as vscode from "vscode";
import * as transitionGraph from "../../transitionGraph";

suite("Extension Test Suite", () => {
    after(() => {
        vscode.window.showInformationMessage("All tests done!");
    });

    test("Round trip transition graph params URIs", () => {
        checkParamsRoundTrip({
            type: "timelines",
            timelines: ["abc123", "def456"],
            groupBy: ["foo", "bar"],
        });

        checkParamsRoundTrip({
            type: "segment",
            segmentId: {
                workspace_version_id: "123",
                rule_name: "foo",
                segment_name: "bar",
            },
            groupBy: ["foo", "bar"],
        });
    });
});

function checkParamsRoundTrip(before: transitionGraph.TransitionGraphParams) {
    const uri = transitionGraph.encodeUri(before);
    const after = transitionGraph.decodeUri(uri);
    assert.deepEqual(before, after);
}
