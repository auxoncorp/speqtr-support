# SpeQTr extension for VS Code

Provides syntax highlighting and language sevices for Auxon's SpeQTr specification language.

## Features

* Syntax highlighting
* Error checking
* Configures the speqtr_lsp language server.

## Extension Settings

This extension contributes the following settings:

* `speqtr.server.path`: Path to the speqtr_lsp executable.
* `speqtr.server.extraEnv`: Extra environment variables that will be passed to the speqtr_lsp executable.
* `modality.url`: The URL of the Auxon Modality backend server, which speqtr_lsp will connect to.
* `modality.insecure`: Ignore certificate validation for https connections to the Modality server.
* `modality.auth_token`: The authentication token to use when connecting to the Modality back end.
* `modality.workspace`: The name of the workspace to use for Modality data operations, including completions.

## Release Notes

### 0.1.0

Initial release
