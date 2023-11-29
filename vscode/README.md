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

## Dependencies

-   Modality CLI: See the [Modality Client documentation](https://docs.auxon.io/modality/installation/client.html)
-   Python: The Jupter notebooks require Python 3, jupyter, pandas, and plotly packages to be installed. We recommend
    creating an isolated environment for this using `venv`.
-   Extensions: The extension will automatically install the `tintinweb.graphviz-interactive-preview`
    and `ms-toolsai.jupyter` extensions by default when installed from the marketplace
