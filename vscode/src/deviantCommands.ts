import * as vscode from "vscode";
import * as config from "./config";
import * as util from "util";
import * as child_process from "child_process";
import { Mutator, MutatorParameter } from "./mutators";

const execFile = util.promisify(child_process.execFile);

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("auxon.deviant.clearMutation", runDeviantMutationClearCommand),
        vscode.commands.registerCommand("auxon.deviant.clearAllMutations", clearAllMutations),
        vscode.commands.registerCommand("auxon.deviant.createMutation", runDeviantMutationCreateCommand),
        vscode.commands.registerCommand("auxon.deviant.runCreateMutationWizard", runCreateMutationWizard)
    );
}

export type ExperimentCreateCommandArgs = {
    experimentName: string;
    file: vscode.Uri;
};

export async function runDeviantExperimentCreateCommand(args: ExperimentCreateCommandArgs) {
    const deviantPath = config.toolPath("deviant");

    const commandArgs = [
        "experiment",
        "create",
        "--file",
        args.file.fsPath,
        args.experimentName,
        ...config.extraCliArgs("deviant experiment create"),
    ];

    try {
        const res = await execFile(deviantPath, commandArgs, { encoding: "utf8" });
        const _dont_wait = vscode.window.showInformationMessage(res.stdout);
    } catch (e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
        if (Object.prototype.hasOwnProperty.call(e, "stderr")) {
            vscode.window.showErrorMessage(e.stderr.trim());
        } else {
            vscode.window.showErrorMessage(e.toString());
        }
    }
}

export type MutationClearCommandArgs = {
    mutationId?: string;
};

async function clearAllMutations() {
    await runDeviantMutationClearCommand({});
}

async function runDeviantMutationClearCommand(args: MutationClearCommandArgs) {
    const deviantPath = config.toolPath("deviant");

    const commandArgs = ["mutation", "clear"];

    if (args.mutationId) {
        commandArgs.push("--mutation-id", args.mutationId);
    }

    for (const extra of config.extraCliArgs("deviant mutation clear")) {
        commandArgs.push(extra);
    }

    try {
        const res = await execFile(deviantPath, commandArgs, { encoding: "utf8" });
        const _dont_wait = vscode.window.showInformationMessage(res.stdout);
    } catch (e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
        if (Object.prototype.hasOwnProperty.call(e, "stderr")) {
            vscode.window.showErrorMessage(e.stderr.trim());
        } else {
            vscode.window.showErrorMessage(e.toString());
        }
    }

    vscode.commands.executeCommand("auxon.mutations.refresh");
}

export type MutationCreateCommandArgs = {
    mutatorId?: string;
    params?: string[];
    experimentName?: string;
};

async function runDeviantMutationCreateCommand(args: MutationCreateCommandArgs) {
    const deviantPath = config.toolPath("deviant");

    const commandArgs = ["mutation", "create", "--format", "json"];

    if (args.mutatorId) {
        commandArgs.push("--mutator-id", args.mutatorId);
    }

    if (args.experimentName) {
        commandArgs.push("--experiment", args.experimentName);
    }

    if (args.params) {
        for (const paramKeyValuePair of args.params) {
            commandArgs.push("--params", paramKeyValuePair);
        }
    }

    for (const extra of config.extraCliArgs("deviant mutation create")) {
        commandArgs.push(extra);
    }

    try {
        const res = await execFile(deviantPath, commandArgs, { encoding: "utf8" });
        const output = JSON.parse(res.stdout) as MutationCreateOutput;
        const _dont_wait = vscode.window.showInformationMessage(`Created mutation '${output.mutation_id}'`);
    } catch (e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
        if (Object.prototype.hasOwnProperty.call(e, "stderr")) {
            vscode.window.showErrorMessage(e.stderr.trim());
        } else {
            vscode.window.showErrorMessage(e.toString());
        }
    }

    vscode.commands.executeCommand("auxon.mutations.refresh");
}

interface MutationCreateOutput {
    mutation_id: string;
}

// TODO - add linked experiment option
async function runCreateMutationWizard(mutator: Mutator) {
    const title = `Create a mutation for mutator '${mutator.name}'`;

    if (mutator.params.length == 0) {
        const options = {
            title,
            placeHolder: "This mutator doesn't have any parameters",
            ignoreFocusOut: true,
            validateInput: validateParameterLess,
        };
        const result = await vscode.window.showInputBox(options);
        if (result !== undefined) {
            vscode.commands.executeCommand("auxon.deviant.createMutation", {
                mutatorId: mutator.id,
            });
        }
    } else {
        let step = 1;
        const maxSteps = mutator.params.length;
        const params = [];

        for (const param of mutator.params) {
            const options = {
                title: `${title} (${step}/${maxSteps})`,
                placeHolder: `Enter the parameter value for '${param.name}' or leave blank for Deviant-suggested values`,
                ignoreFocusOut: true,
                validateInput: (input: string) => validateParameter(input, param),
            };
            let paramValue = await vscode.window.showInputBox(options);
            if (paramValue === undefined) {
                // User canceled
                return;
            } else if (paramValue !== "") {
                // Normalize so the CLI parses as a float
                if (param.valueType === "Float" && !paramValue.includes(".")) {
                    paramValue = `${paramValue}.0`;
                }

                params.push(`${param.name}=${paramValue}`);
            }

            step += 1;
        }

        vscode.commands.executeCommand("auxon.deviant.createMutation", {
            mutatorId: mutator.id,
            params,
        });
    }
}

function validateParameterLess(input: string): string | null {
    if (input.length === 0) {
        return null;
    } else {
        return "This mutator is parameter-less. Leave the field empty to continue.";
    }
}

function validateParameter(input: string, param: MutatorParameter): string | null {
    if (input === "") {
        // Empty string is allowed, means we'll use a deviant-suggested value
        return null;
    }

    if (param.valueType === "Float") {
        if (isFloat(input)) {
            return null;
        } else {
            return "Value must be a float type";
        }
    } else if (param.valueType === "Integer") {
        if (isInt(input)) {
            return null;
        } else {
            return "Value must be an integer type";
        }
    } else {
        return null;
    }
}

function isFloat(val: string) {
    const floatRegex = /^-?\d+(?:[.]\d*?)?$/;
    if (!floatRegex.test(val)) {
        return false;
    }

    const fVal = parseFloat(val);
    if (isNaN(fVal)) {
        return false;
    }
    return true;
}

function isInt(val: string) {
    const intRegex = /^-?\d+$/;
    if (!intRegex.test(val)) {
        return false;
    }

    const intVal = parseInt(val, 10);
    return parseFloat(val) == intVal && !isNaN(intVal);
}
