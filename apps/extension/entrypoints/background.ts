// Background service worker (Unit U18).
//
// Collects detected-post messages from the content scripts and forwards each to
// the desktop app's local HTTP bridge. For this unit the desktop only receives
// the payload and re-emits a `detected-post` Tauri event; cross-posting is U19.

import {
  BRIDGE_INGEST_URL,
  DETECTED_POST_MESSAGE,
  type DetectedPostMessage,
} from "../lib/detection";

const DELIVERY_TIMEOUT_MS = 5000;

function isDetectedPostMessage(
  message: unknown
): message is DetectedPostMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === DETECTED_POST_MESSAGE
  );
}

async function deliverToDesktop(message: DetectedPostMessage): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    // Send as text/plain so the service-worker fetch stays a CORS "simple
    // request" and skips the OPTIONS preflight the local Axum bridge does not
    // answer. The bridge parses the body as JSON manually.
    const response = await fetch(BRIDGE_INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(message.payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.debug("[outpost] bridge rejected detected post", response.status);
    }
  } catch (error) {
    // Desktop app may be closed; detection is best-effort.
    console.debug("[outpost] could not reach desktop bridge", error);
  } finally {
    clearTimeout(timer);
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isDetectedPostMessage(message)) {
      return;
    }
    // Fire and forget; listener stays synchronous so the channel closes cleanly.
    deliverToDesktop(message).catch(() => {
      // Delivery already swallows its own errors; this guard is belt-and-braces.
    });
  });
});
