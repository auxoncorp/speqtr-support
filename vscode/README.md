# SpeQTr extension for VS Code

Provides syntax highlighting and language sevices for Auxon's SpeQTr specification language.

## Features

-   Syntax highlighting
-   Error checking
-   Configures the speqtr_lsp language server.
-   Code lens support for running Conform specs
-   A workspace tree view

## Extension Settings

This extension contributes the following settings:

-   `auxon.tooldir`: The directory where the Auxon tool binaries (modality, conform, etc) may be found.
-   `auxon.authToken`: The user authentication token to use when connecting to the Modality backend. If not given, defaults to the auth token configured in the Modality CLI.
-   `auxon.modalityUrl`: The URL of the Auxon Modality backend server. If not given defaults, to the URL configured in the Modality CLI, or else to 'http://localhost:14181'.
-   `auxon.allowInsecureHttps`: Ignore certificate validation for https connections. If not given, defaults to the setting configured in the Modality CLI, or else to false.
-   `auxon.extraEnv`: Extra environment variables that will be passed tool executables, including the SpeQTr LSP server.

## Development

-   Start the background build process: `npm run watch`
-   Regenerate the api stubs: `npm run codegen`
