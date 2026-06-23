import { initTracing } from "./tracing.js";

initTracing();

import { auth } from "@outpost/auth";
import { env } from "@outpost/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { posthog } from "./lib/posthog.js";
import { otelMiddleware } from "./middleware/otel.js";
import { otelLoggerMiddleware } from "./middleware/otel-logger.js";
import { companionRouter } from "./routes/companion.js";
import { polarRouter } from "./routes/polar.js";

const ALLOWED_ORIGINS = [
  env.CORS_ORIGIN,
  // Tauri desktop app origins (macOS uses tauri://, Windows/Linux use https://tauri.localhost)
  "tauri://localhost",
  "https://tauri.localhost",
];

const app = new Hono();

app.use(logger());
app.use(otelMiddleware);
app.use(otelLoggerMiddleware);
app.use(
  "/*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    credentials: true,
  })
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/polar", polarRouter);
app.route("/api/companion", companionRouter);

app.get("/", (c) => {
  return c.text("OK");
});

app.onError((err, c) => {
  posthog?.captureException(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
