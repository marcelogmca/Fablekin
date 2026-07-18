> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

# VN Viewer API Reference

The VN Viewer communicates with the backend and other views via **Socket.io** events. This reference list the most common events used for synchronization and UI control.

| Event Name | Direction | Payload | Description |
| --- | --- | --- | --- |
| docs:open | To View | { docId: string } | Triggers the Docs tab and opens a specific document by ID. |
| switch-tab | To App | { tab: string } | Switches the entire application to a specific tab. |
| project-changed | From App | { projectName: string } | Fired when the user switches projects. |

## Socket Namespace

All communication happens on the runtime app socket endpoint passed via URL query parameters (localhost + dynamic port). Ensure your module or plugin reads those values instead of hardcoding a port.