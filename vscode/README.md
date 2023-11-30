# Auxon's UI extension for VS Code

Auxon's UI extension provides data visualization for Modality, and syntax highlighting and language services
for the SpeQTr specification language.

## Features

-   Tree views for interacting with [Modality](https://auxon.io/products/modality) and [Conform](https://docs.auxon.io/conform/) data
-   Syntax highlighting
-   Error checking
-   Configures the `speqtr_lsp` language server.
-   Code lens support for running Conform specs

## Extension Settings

This extension contributes the following settings:

-   `auxon.tooldir`: The directory where the Auxon tool binaries (modality, conform, etc) may be found.
-   `auxon.authToken`: The user authentication token to use when connecting to the Modality backend. If not given, defaults to the auth token configured in the Modality CLI.
-   `auxon.modalityUrl`: The URL of the Auxon Modality backend server. If not given defaults, to the URL configured in the Modality CLI, or else to 'http://localhost:14181'.
-   `auxon.allowInsecureHttps`: Ignore certificate validation for https connections. If not given, defaults to the setting configured in the Modality CLI, or else to false.
-   `auxon.extraEnv`: Extra environment variables that will be passed tool executables, including the SpeQTr LSP server.

## Dependencies

-   Modality CLI: See the [Modality Client documentation](https://docs.auxon.io/modality/installation/client.html)
-   Conform CLI: See the [Conform Client documentation](https://docs.auxon.io/conform/installation/client.html)
-   Python: The Jupyter notebooks require Python 3, jupyter, pandas, and plotly packages to be installed. We recommend
    creating an isolated environment for this using `venv`.
-   Extensions: The extension will automatically install the `tintinweb.graphviz-interactive-preview`
    and `ms-toolsai.jupyter` extensions by default when installed from the marketplace
