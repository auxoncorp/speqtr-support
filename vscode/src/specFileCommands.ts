
import * as vscode from "vscode";
import * as api from "./modalityApi";
import * as config from "./config";
import * as util from "util";
import * as child_process from "child_process";
import * as path from "path";
import { pathToFileURL } from "url";

const execFile = util.promisify(child_process.execFile);

export function register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("auxon.specDir.eval", specDirEval),
        vscode.commands.registerCommand("auxon.specDir.eval.dryRun", specDirEvalDryRun),
        vscode.commands.registerCommand("auxon.specFile.eval", specFileEval),
        vscode.commands.registerCommand("auxon.specFile.eval.dryRun", specFileEvalDryRun),
        vscode.commands.registerCommand("auxon.specFile.create", createSpec),
        vscode.commands.registerCommand("auxon.conform.eval", runConformEvalCommand),
    );

    // walk the workspace to identify directories that have speqtr files in them
    // TODO how do you update this list, when someone adds a new file? Is there a 'workspace changed' hook or s.t.?
    // TODO how can we get this to run without first clicking on a spec file?
    // TODO should this walk up the tree? What does that mean?
    vscode.workspace.findFiles("**/*.speqtr").then((specFiles) => {
        const specDirs = specFiles.map((f) => path.parse(f.fsPath).dir);
        const uniqueSpecDirs = [...new Set(specDirs)];
        const uniqueSpecDirUris = uniqueSpecDirs.map(pathToFileURL);
        vscode.commands.executeCommand("setContext", "auxon.specFolders", uniqueSpecDirUris);
    });
}

async function specDirEval(dir: vscode.Uri) {
    const specPrefix = await promptForSpecName("Eval specs in dir: what name prefix should be used when storing specs on the server?", dir, true);
    if (!specPrefix) { return; }

    const specFiles = await vscode.workspace.findFiles("**/*.speqtr");
    const specNames = [];
    for (const specFile of specFiles) {
        const specName = specPrefix + path.parse(specFile.fsPath).base;
        await upsertSpec(specName, specFile);
        specNames.push(specName);
    }
    
    // TODO eval specs in batch, with --name
}

async function specDirEvalDryRun(dir: vscode.Uri) {
    const specFiles = await vscode.workspace.findFiles("**/*.speqtr");
    // TODO eval specs in batch, with --file
}

async function specFileEval(file: vscode.Uri) {
    const specName = await promptForSpecName("Check spec file: what should this spec be named on the server?", file);
    if (!specName) { return; }

    await upsertSpec(specName, file);
    await runConformEvalCommand({spec_name: specName, dry_run: false});
}

async function specFileEvalDryRun(file: vscode.Uri) {
    await runConformEvalCommand({document_uri: file.toString(),  dry_run: true});
}

async function createSpec(file: vscode.Uri) {
    const specName = await promptForSpecName("Upload spec file: what should this spec be named on the server?", file);
    if (!specName) { return; }

    await upsertSpec(specName, file);
}

// TODO save the chosen spec name in the workspace, if different from the default
async function promptForSpecName(prompt: string, file: vscode.Uri, isDir?: boolean) : Promise<string | undefined> {
    var defaultSpecName = vscode.workspace.name + "/" + vscode.workspace.asRelativePath(file).toString();
    if (isDir) {
        defaultSpecName += "/";
    }
    return await vscode.window.showInputBox({title: prompt, value: defaultSpecName});
}

async function upsertSpec(name: string, file: vscode.Uri) : Promise<void> {
    const conform = config.toolPath("conform");
    var spec_exists = false;
    try { 
        await execFile(conform, ["spec", "inspect", name], { encoding: "utf8" });
        // if it didn't error (that is, if it had a zero return code), the spec exists
        spec_exists = true;
    } catch { }

    const verb = spec_exists ? "update" : "create"; 
    await execFile(conform, ["spec", verb, name, "--file", file.fsPath], { encoding: "utf8" });
}


// This has to match the json returned by the lsp server for the 'auxon.conform.eval' action
export type SpecEvalCommandArgs = {
    document_uri?: string;
    spec_name?: string;
    spec_version?: string,
    behavior?: string;
    dry_run: boolean;
};

export function runConformEvalCommand(args: SpecEvalCommandArgs) : Thenable<vscode.TaskExecution> {
    const conformPath = config.toolPath("conform");

    var commandArgs = ["spec", "eval"];
    if (args.document_uri) {
       commandArgs.push("--file", vscode.Uri.parse(args.document_uri).fsPath) ;
    }

    if (args.spec_name) {
       commandArgs.push("--name", args.spec_name) ;
    }

    if (args.spec_version) {
       commandArgs.push("--version", args.spec_version) ;
    }

    if (args.behavior) {
        commandArgs.push("--behavior", args.behavior);
    }

    if (args.dry_run) {
        commandArgs.push("--dry-run");
    }

    const taskDef: vscode.TaskDefinition = {
        type: "auxon.conform.eval",
        command: conformPath,
        args: commandArgs,
    };

    const problemMatchers = ["$conformEval"];

    let scope: vscode.WorkspaceFolder;
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        scope = vscode.workspace.workspaceFolders[0];
    } else {
        throw Error("Can't run 'conform eval' without a workspace");
    }

    const exec = new vscode.ProcessExecution(taskDef.command, taskDef.args);
    const task = new vscode.Task(taskDef, scope, "conform spec eval", "conform", exec, problemMatchers);

    task.group = vscode.TaskGroup.Build;
    task.presentationOptions = {
        echo: true,
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Dedicated,
        clear: true,
    };

    return vscode.tasks.executeTask(task);
}


// export function runConformEvalCommandMulti(argss: SpecEvalCommandArgs[]) : Thenable<vscode.TaskExecution> {
//     // TODO
// }