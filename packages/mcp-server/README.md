# @outpost/mcp-server

MCP server that proxies tool calls from Claude Desktop (and other MCP clients) to the Outpost HTTP bridge running locally on port 37842.

## Build

```bash
cd packages/mcp-server
bun install
bun run build
```

This compiles `src/index.ts` to `dist/index.js`.

## Claude Desktop Configuration

Add to your `claude_desktop_config.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "outpost": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Outpost must be running for tool calls to succeed. The server will start but requests will fail until the app is open.

## Authentication

The bridge is privileged and requires a per-install secret token on every request (loopback binding and Host-header validation alone do not stop other local processes / web pages). Outpost writes the token to `~/.outpost/bridge-token` at startup, and this server reads it from there automatically - no configuration needed in the common case.

If your MCP launcher cannot read the home directory (sandboxes, some container setups), set `OUTPOST_BRIDGE_TOKEN` explicitly. Copy the value from Outpost → Settings → Browser extension.

```json
{
  "mcpServers": {
    "outpost": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OUTPOST_BRIDGE_TOKEN": "paste-token-here"
      }
    }
  }
}
```

## Environment Variables

- `OUTPOST_API_URL` - Override the default bridge URL (`http://localhost:37842`). Useful if Outpost is configured to use a non-default port.
- `OUTPOST_BRIDGE_TOKEN` - Override the bridge token instead of reading `~/.outpost/bridge-token`. Required only when the file is not readable.

Example:

```json
{
  "mcpServers": {
    "outpost": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "OUTPOST_API_URL": "http://localhost:9000"
      }
    }
  }
}
```
