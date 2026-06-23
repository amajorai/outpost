// Background service worker (Unit U18).
//
// Collects detected-post messages from the content scripts and forwards each to
// the desktop app's local HTTP bridge. For this unit the desktop only receives
// the payload and re-emits a `detected-post` Tauri event; cross-posting is U19.

import {
  BRIDGE_INGEST_URL,
  BRIDGE_TOKEN_STORAGE_KEY,
  DETECTED_POST_MESSAGE,
  type DetectedPostMessage,
} from "../lib/detection";

const DELIVERY_TIMEOUT_MS = 5000;

/**
 * Read the bridge token the user pasted into the extension popup. The desktop
 * bridge rejects any request without it, so detection delivery is a no-op until
 * the user copies the token from Outpost → Settings → Browser extension.
 */
async function getBridgeToken(): Promise<string> {
  try {
    const stored = await browser.storage.local.get(BRIDGE_TOKEN_STORAGE_KEY);
    const value = stored[BRIDGE_TOKEN_STORAGE_KEY];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

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
  const token = await getBridgeToken();
  if (token.length === 0) {
    console.debug(
      "[outpost] no bridge token configured; skipping delivery. Set it in the extension popup."
    );
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    // Body stays text/plain (the bridge parses JSON manually). The extension
    // declares http://localhost:37842/* in host_permissions, so the
    // service-worker fetch bypasses CORS and the X-Outpost-Token header does not
    // trigger a preflight. The bridge requires this per-install token on every
    // request, which a random web page cannot obtain.
    const response = await fetch(BRIDGE_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "X-Outpost-Token": token,
      },
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
