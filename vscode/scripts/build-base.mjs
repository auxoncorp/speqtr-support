import * as esbuild from "esbuild";

var watch = false;
var sourcemap = false;
var minify = false;
var bundle = false;

for (const arg of process.argv.slice(2)) {
    switch (arg) {
        case "--watch":
            watch = true;
            break;
        case "--sourcemap":
            // "inline" is needed for source maps to work for webview code
            sourcemap = "inline";
            break;
        case "--minify":
            minify = true;
            break;
        default:
            console.error("Unknown flag: " + arg);
            process.exit(-1);
    }
}

console.log("Running esbuild");
console.log({ watch, sourcemap, minify });

const buildStatusPlugin = {
    name: "buildStatus",
    setup(build) {
        build.onEnd((result) => {
            console.log(`Build finished with ${result.errors.length} errors`);
        });
    },
};

let ctxMain = await esbuild.context({
    plugins: [buildStatusPlugin],
    entryPoints: ["src/main.ts", "src/test/runTest.ts"],
    bundle: true,
    treeShaking: true,
    outdir: "out",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node16",
    sourcemap,
    minify,
});

let ctxWebView = await esbuild.context({
    plugins: [buildStatusPlugin],
    entryPoints: ["webview-src/transitionGraphWebView.ts", "webview-src/experimentImpactWebView.ts"],
    bundle: true,
    treeShaking: true,
    outdir: "out",
    format: "iife",
    platform: "browser",
    sourcemap,
    minify,
});

if (watch) {
    await Promise.all([ctxMain.watch(), ctxWebView.watch()]);
    console.log("Polling for source file changes...");
} else {
    let results = await Promise.all([ctxMain.rebuild(), ctxWebView.rebuild()]);
    for (const result of results) {
        console.log(result);
    }

    ctxWebView.dispose();
    ctxMain.dispose();
}
