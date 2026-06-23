#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

const OUTPOST_URL = process.env.OUTPOST_API_URL ?? "http://localhost:37842";

/**
 * The bridge requires a per-install shared secret on every request. Outpost
 * writes it to ~/.outpost/bridge-token; prefer the OUTPOST_BRIDGE_TOKEN env var
 * (for sandboxed launchers that cannot read the home dir) and fall back to the
 * file. An empty token still lets the process start, but requests will 401
 * until the token is configured.
 */
function loadBridgeToken(): string {
  const fromEnv = process.env.OUTPOST_BRIDGE_TOKEN;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  try {
    return readFileSync(
      join(homedir(), ".outpost", "bridge-token"),
      "utf8"
    ).trim();
  } catch {
    return "";
  }
}

const BRIDGE_TOKEN = loadBridgeToken();

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    Authorization: `Bearer ${BRIDGE_TOKEN}`,
    "X-Outpost-Token": BRIDGE_TOKEN,
  };
}

const server = new Server(
  { name: "outpost", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(
  ListToolsRequestSchema,
  async (): Promise<ListToolsResult> => {
    const res = await fetch(`${OUTPOST_URL}/api/tools`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as ListToolsResult;
  }
);

server.setRequestHandler(
  CallToolRequestSchema,
  async (req): Promise<CallToolResult> => {
    const res = await fetch(`${OUTPOST_URL}/api/tools/call`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: req.params.name,
        arguments: req.params.arguments ?? {},
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as CallToolResult;
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
