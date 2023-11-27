import * as api from "./modalityApi";
import * as vscode from "vscode";
import * as handlebars from "handlebars";
("");
import * as fs from "fs";

export interface SpecCoverageParams {
    segmentId: api.WorkspaceSegmentId;
    specNames?: string[];
    specVersions?: string[];
    specResultIds?: api.SpecEvalResultId[];
    specFilter?: string;
    caseFilter?: string;
}

/// Shows a spec coverage report as a webview, when asked.
export class SpecCoverageProvider {
    private template?: HandlebarsTemplateDelegate<TemplateContext>;
    constructor(private readonly apiClient: api.Client) {}

    async initialize(context: vscode.ExtensionContext) {
        const templateUri = vscode.Uri.joinPath(context.extensionUri, "src", "specCoverage.handlebars.html");

        const templateText = fs.readFileSync(templateUri.fsPath, "utf8");
        this.template = handlebars.compile(templateText);

        handlebars.registerHelper("pluralize", (num, singular, plural) => (num == 1 ? singular : plural));
        handlebars.registerHelper("shortPercent", (num) => {
            if (num == 100) {
                return "100%";
            } else {
                return `${num.toFixed(2)}%`;
            }
        });
    }

    async showSpecCoverage(params: SpecCoverageParams) {
        const coverage = await this.apiClient
            .segment(params.segmentId)
            .specCoverage(
                params.specNames,
                params.specVersions,
                params.specResultIds,
                params.specFilter,
                params.caseFilter
            );

        let percentageBehaviorsCovered = 0.0;
        if (coverage.coverage_aggregates.n_behaviors > 0 && coverage.coverage_aggregates.n_behaviors_executed > 0) {
            percentageBehaviorsCovered = 100.0 - coverage.coverage_aggregates.percentage_behaviors_vacuous;
        }

        const html = this.template({
            designUnit: 8,
            borderWidth: 1,
            cornerRadius: 0,
            header: {
                percentageSpecsExecuted: coverage.coverage_aggregates.percentage_specs_executed,
                percentageSpecsPassing: coverage.coverage_aggregates.percentage_specs_passing,
                percentageBehaviorsCovered,
                percentageCasesEverMatched: coverage.coverage_aggregates.percentage_cases_ever_matched,
            },
            specs: coverage.spec_coverages.map(specViewModel),
            params,
            percentageBehaviorsCovered,
        });

        const panel = vscode.window.createWebviewPanel(
            "auxon.specCoverageView",
            `Coverage Report: ${params.segmentId.segment_name}`,
            vscode.ViewColumn.One,
            {}
        );
        panel.webview.html = html;
    }
}

interface TemplateContext {
    designUnit: number,
    borderWidth: number,
    cornerRadius: number,
    header: HeaderViewModel;
    specs: SpecViewModel[];
    params: SpecCoverageParams;
    percentageBehaviorsCovered: number;
}

interface HeaderViewModel {
    percentageSpecsExecuted: number;
    percentageSpecsPassing: number;
    percentageBehaviorsCovered: number;
    percentageCasesEverMatched: number;
}

type Status = "passed" | "failed" | "not-executed";

interface SpecViewModel {
    name: string;
    executed: boolean;
    passed: boolean;
    status: Status;

    percentageBehaviorsCovered: number;
    percentageCasesCovered: number;
    numSpecBehaviors: number,
    numSpecBehaviorsCovered: number,
    numSpecCases: number,
    numSpecCasesCovered: number,

    behaviors: BehaviorViewModel[];
}

interface BehaviorViewModel {
    name: string;
    executed: boolean;
    passed: boolean;
    triggerCount: number;
    status: Status;
    cases: CaseViewModel[];
}

interface CaseViewModel {
    name: string;
    everMatched: boolean;
    matchCount: number;
    status: Status;
}

function specViewModel(sc: api.SpecCoverage): SpecViewModel {

    let numSpecBehaviors = 0;
    let numSpecBehaviorsCovered = 0;
    let numSpecCases = 0;
    let numSpecCasesCovered = 0;

    for (const [_b_name, behaviorCoverage] of Object.entries(sc.behavior_to_coverage)) {
        numSpecBehaviors += 1;
        if (behaviorCoverage.test_counts.ever_executed && !behaviorCoverage.ever_vacuous) {
            numSpecBehaviorsCovered += 1;
        }
        for (const [_c_name, caseCoverage] of Object.entries(behaviorCoverage.case_coverage)) {
            numSpecCases += 1;
            if (caseCoverage.ever_matched) {
                numSpecCasesCovered += 1;
            }
        }
    }

    let percentageBehaviorsCovered = 0.0;
    if (numSpecBehaviors != 0) {
        percentageBehaviorsCovered = (100.0 * numSpecBehaviorsCovered) / numSpecBehaviors;
    }

    let percentageCasesCovered = 0.0;
    if (numSpecCases != 0) {
        percentageCasesCovered = (100.0 * numSpecCasesCovered) / numSpecCases;
    }

    let status: Status = "not-executed";
    if (sc.test_counts.ever_executed) {
        if (sc.test_counts.ever_failed) {
            status = "failed";
        } else {
            status = "passed";
        }
    }

    const behaviors = Object.values(sc.behavior_to_coverage).map(behaviorViewModel);
    const anyNotExecuted = behaviors.map((b) => b.status == "not-executed").reduce((a, b) => a || b);
    if (anyNotExecuted) {
        status = "not-executed";
    }

    return {
        name: sc.spec_at_version_meta.name,
        executed: sc.test_counts.ever_executed,
        passed: sc.test_counts.ever_passed,
        status,
        percentageBehaviorsCovered,
        percentageCasesCovered,
        numSpecBehaviors,
        numSpecBehaviorsCovered,
        numSpecCases,
        numSpecCasesCovered,
        behaviors,
    };
}

function behaviorViewModel(bhCov: api.BehaviorCoverage): BehaviorViewModel {
    const triggerCount = Object.values(bhCov.case_coverage).map((cc) => cc.matched_n_times).reduce((a, b) => a + b);

    let status: Status = "not-executed";
    // TODO use api value once it exists
    if (bhCov.test_counts.ever_executed && triggerCount > 0) {
        if (bhCov.test_counts.ever_failed) {
            status = "failed";
        } else {
            status = "passed";
        }
    }

    return {
        name: bhCov.name,
        executed: bhCov.test_counts.ever_executed,
        passed: !bhCov.test_counts.ever_failed,
        triggerCount,
        status,
        cases: Object.values(bhCov.case_coverage).map(caseViewModel),
    };
}

function caseViewModel(cCov: api.CaseCoverage): CaseViewModel {
    return {
        name: cCov.name,
        status: cCov.ever_matched ? "passed" : "not-executed",
        everMatched: cCov.ever_matched,
        matchCount: cCov.matched_n_times
    };
}
