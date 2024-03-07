import * as util from "util";
import * as vscode from "vscode";
import * as child_process from "child_process";
import * as config from "./config";
import { toolPath } from "./config";

const execFile = util.promisify(child_process.execFile);

/**
 * Create a new default user if no users exist (fresh modality install).
 */
export async function handleNewUserCreation() {
    const numUsers = await numberOfModalityUsers();
    if (numUsers == 0) {
        const title = "Looks like this is a fresh install. Would you like to create a default user?";
        const placeHolder = "user name";
        const newUser = await vscode.window.showInputBox({ title, placeHolder });
        if (newUser) {
            await createAndUseNewUser(newUser);
        }
    }
}

/**
 * Prompt for an auth token, returning it if the user provided a valid one.
 */
export async function promptForValidAuthToken(): Promise<string | null> {
    const title = "An auth token is required to use the Auxon extension. Enter the auth token to use.";
    const placeHolder = "auth token";
    const validateInput = async (text: string) => {
        if (await validateUserAuthToken(text)) {
            return null;
        } else {
            return "Not a valid auth token";
        }
    };
    const userSuppliedAuthToken = await vscode.window.showInputBox({ title, placeHolder, validateInput });
    if (userSuppliedAuthToken) {
        return userSuppliedAuthToken;
    } else {
        return null;
    }
}

/**
 * Get the number of users from 'modality user list'.
 */
async function numberOfModalityUsers(): Promise<number> {
    const modality = toolPath("modality");
    const res = await execFile(
        modality,
        ["user", "list", "--format", "json", ...config.extraCliArgs("modality user list")],
        { encoding: "utf8" }
    );

    return JSON.parse(res.stdout).users.length as number;
}

/**
 * Create and use a new user.
 */
async function createAndUseNewUser(userName: string) {
    const modality = toolPath("modality");
    await execFile(
        modality,
        ["user", "create", "--use", "--format", "json", userName, ...config.extraCliArgs("modality user create")],
        { encoding: "utf8" }
    );
}

/**
 * Check if the auth token is valid.
 */
async function validateUserAuthToken(authToken: string): Promise<boolean> {
    const modality = toolPath("modality");
    try {
        const res = await execFile(
            modality,
            [
                "user",
                "inspect-auth-token",
                "--format",
                "json",
                authToken,
                ...config.extraCliArgs("modality user inspect-auth-token"),
            ],
            { encoding: "utf8" }
        );
        return "user_name" in JSON.parse(res.stdout);
    } catch (e) {
        return false;
    }
}
