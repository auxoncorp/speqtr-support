const fs = require("fs");

fs.copyFile("node_modules/@vscode/codicons/dist/codicon.css", "resources/dist/codicon.css", (err) => {
    if (err) throw err;
    console.log("codicon.css was copied to resources/dist");
});

fs.copyFile("node_modules/@vscode/codicons/dist/codicon.ttf", "resources/dist/codicon.ttf", (err) => {
    if (err) throw err;
    console.log("codicon.ttf was copied to resources/dist");
});
