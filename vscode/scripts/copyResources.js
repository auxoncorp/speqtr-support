const fs = require("fs");

// if (!fs.existsSync("resources/dist/")) {
//     fs.mkdirSync("resources/dist/");
// }

// fs.copyFile("node_modules/jquery/dist/jquery.min.js", "resources/dist/jquery.min.js", (err) => {
//     if (err) throw err;
//     console.log("jquery.min.js was copied to resources/dist");
// });

// fs.copyFile("node_modules/jquery-color/dist/jquery.color.min.js", "resources/dist/jquery.color.min.js", (err) => {
//     if (err) throw err;
//     console.log("jquery.color.min.js was copied to resources/dist");
// });

// fs.copyFile(
//     "node_modules/@vscode/webview-ui-toolkit/dist/toolkit.min.js",
//     "resources/dist/webviewuitoolkit.min.js",
//     (err) => {
//         if (err) throw err;
//         console.log("webviewuitoolkit.min.js was copied to resources/dist");
//     }
// );

fs.copyFile("node_modules/@vscode/codicons/dist/codicon.css", "resources/dist/codicon.css", (err) => {
    if (err) throw err;
    console.log("codicon.css was copied to resources/dist");
});

fs.copyFile("node_modules/@vscode/codicons/dist/codicon.ttf", "resources/dist/codicon.ttf", (err) => {
    if (err) throw err;
    console.log("codicon.ttf was copied to resources/dist");
});

// fs.copyFile(
//     "node_modules/cytoscape-cose-bilkent/node_modules/cose-base/cose-base.js",
//     "resources/dist/cose-base.js",
//     (err) => {
//         if (err) throw err;
//         console.log("cose-base.js was copied to resources/dist");
//     }
// );

// fs.copyFile(
//     "node_modules/cytoscape-cose-bilkent/cytoscape-cose-bilkent.js",
//     "resources/dist/cytoscape-cose-bilkent.js",
//     (err) => {
//         if (err) throw err;
//         console.log("cytoscape-cose-bilkent.js was copied to resources/dist");
//     }
// );

// fs.copyFile("node_modules/cytoscape/dist/cytoscape.min.js", "resources/dist/cytoscape.min.js", (err) => {
//     if (err) throw err;
//     console.log("cytoscape.min.js was copied to resources/dist");
// });

// fs.copyFile("node_modules/layout-base/layout-base.js", "resources/dist/layout-base.js", (err) => {
//     if (err) throw err;
//     console.log("layout-base.js was copied to resources/dist");
// });

// fs.copyFile(
//     "node_modules/cytoscape-context-menus/cytoscape-context-menus.js",
//     "resources/dist/cytoscape-context-menus.js",
//     (err) => {
//         if (err) throw err;
//         console.log("cytoscape-context-menus.js was copied to resources/dist");
//     }
// );
