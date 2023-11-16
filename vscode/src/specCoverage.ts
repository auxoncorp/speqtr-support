import * as api from "./modalityApi";
import * as vscode from "vscode";

interface SpecCoverageParams {
    segmentId: api.WorkspaceSegmentId
}

export async function showSpecCoverage(params: SpecCoverageParams, apiClient: api.Client) {
    const coverage = await apiClient.segment(params.segmentId).specCoverage()
    let html = "<html>";
    html += `<h1>Coverage report for segment ${params.segmentId.segment_name}</h1>`;

    // TODO - headline values from segment_spec_coverage.coverage_aggregates
    // % behaviors non-vacuous (called "covered" here)
    let percentage_behaviors_covered = 0.0
    if (coverage.coverage_aggregates.n_behaviors > 0 && coverage.coverage_aggregates.n_behaviors_executed > 0) {
        percentage_behaviors_covered = 100.0 - coverage.coverage_aggregates.percentage_behaviors_vacuous;
    }
    coverage.coverage_aggregates.percentage_specs_executed
    html += "<table>";
    html += "<tr>"
    html += "<th>Specs Executed</th><th>Specs Passing</th><th>% Behaviors Covered</th><th>% Cases Covered</th>";
    html += "</tr>"
    html += "<tr>"
    html += `<td>${coverage.coverage_aggregates.percentage_specs_executed}%</td>`;
    html += `<td>${coverage.coverage_aggregates.percentage_specs_passing}%</td>`;
    html += `<td>${percentage_behaviors_covered}%</td>`;
    html += `<td>${coverage.coverage_aggregates.percentage_cases_ever_matched}%</td>`;
    html += "</tr>"
    html += "</table>";

    let optional_s = "";
    if (coverage.spec_coverages.length != 1) {
        optional_s = "s";
    }
    html += `<h2>Per-Spec Breakdown (${coverage.coverage_aggregates.n_specs} spec${optional_s}) </h2>`;

    html += "<table>";
    html += "<tr>"
    html += "<th>Name</th><th>Executed</th><th>Passing</th><th>Behaviors Covered</th><th>% Cases Covered</th>";
    html += "</tr>"
    for (const spec_coverage of coverage.spec_coverages) {
        html += "<tr>"
        html += `<td>${spec_coverage.spec_at_version_meta.name}</td>`;
        html += `<td>${spec_coverage.testy_counts.ever_executed}</td>`;
        html += `<td>${spec_coverage.testy_counts.ever_passed}</td>`;
        let n_spec_behaviors = 0;
        let n_spec_behaviors_covered = 0;
        let n_spec_cases = 0;
        let n_spec_cases_covered = 0;
        for (const [_b_name, behavior_coverage] of Object.entries(spec_coverage.behavior_to_coverage)) {
            n_spec_behaviors += 1;
            if (behavior_coverage.testy_counts.ever_executed && !behavior_coverage.ever_vacuous) {
                n_spec_behaviors_covered += 1;
            }
            for (const [_c_name, case_coverage] of Object.entries(behavior_coverage.case_coverage)) {
                n_spec_cases += 1;
                if (case_coverage.ever_matched) {
                    n_spec_cases_covered += 1;
                }
            }
        }
        let spec_behaviors_covered_percentage = 0.0;
        if (n_spec_behaviors != 0) {
            spec_behaviors_covered_percentage = (100.0 * n_spec_behaviors_covered) / n_spec_behaviors;
        }
        let spec_cases_covered_percentage = 0.0;
        if (n_spec_cases != 0) {
            spec_cases_covered_percentage = (100.0 * n_spec_cases_covered) / n_spec_cases;
        }
        html += `<td>${spec_behaviors_covered_percentage}%   (${n_spec_behaviors_covered}/${n_spec_behaviors})</td>`;
        html += `<td>${spec_cases_covered_percentage}%   (${n_spec_cases_covered}/${n_spec_cases})</td>`;
        html += "</tr>"
    }
    html += "</table>";

    html += "</html>";

    const panel = vscode.window.createWebviewPanel(
        "auxon.specCoverageView",
        `Coverage Report: ${params.segmentId.segment_name}`,
        vscode.ViewColumn.One,
        {}
    );
    panel.webview.html = html;
}
