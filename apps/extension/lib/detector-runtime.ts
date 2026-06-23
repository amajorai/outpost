// Site-agnostic runtime that drives a per-site detection adapter.
//
// The adapter supplies the site-specific DOM heuristics; this runtime owns the
// shared lifecycle: watching for submit intent, debouncing, confirming via a
// success affordance, and dispatching the result to the background script.

import {
  DETECTED_POST_MESSAGE,
  type DetectedMedia,
  type DetectedPlatform,
  type DetectedPost,
  type DetectedPostMessage,
  isDeliverable,
  normalizeText,
} from "./detection";

export interface ComposeSnapshot {
  text: string;
  media: DetectedMedia[];
}

export interface DetectionAdapter {
  platform: DetectedPlatform;
  /**
   * Read the current authored content from the active composer.
   * Returns null when no composer with content is present.
   */
  readComposer: () => ComposeSnapshot | null;
  /**
   * Decide whether a DOM event represents the user submitting their own post
   * (button click on the composer's submit control, or keyboard submit).
   */
  isSubmitEvent: (event: Event) => boolean;
  /**
   * After a submit, wait for a success affordance (toast / view link) and
   * return the confirmed permalink, or null if confirmation timed out.
   * Resolving at all (even with a null permalink) counts as a confirmed post.
   * Rejecting / never resolving suppresses delivery (likely a false positive).
   */
  awaitConfirmation: () => Promise<string | null>;
}

const SUBMIT_DEBOUNCE_MS = 400;

function deliver(post: DetectedPost): void {
  if (!isDeliverable(post)) {
    return;
  }
  const message: DetectedPostMessage = {
    type: DETECTED_POST_MESSAGE,
    payload: post,
  };
  browser.runtime.sendMessage(message).catch((error: unknown) => {
    // Background may be asleep; this is best-effort and must never throw on-page.
    console.debug("[outpost] failed to deliver detected post", error);
  });
}

export function startDetector(adapter: DetectionAdapter): void {
  let lastSubmitAt = 0;
  let inFlight = false;

  const handleSubmit = (event: Event): void => {
    try {
      if (!adapter.isSubmitEvent(event)) {
        return;
      }
      const now = Date.now();
      if (inFlight || now - lastSubmitAt < SUBMIT_DEBOUNCE_MS) {
        return;
      }
      lastSubmitAt = now;

      // Snapshot BEFORE the composer clears on a successful submit.
      const snapshot = adapter.readComposer();
      if (!snapshot) {
        return;
      }
      const text = normalizeText(snapshot.text);
      if (text.length === 0 && snapshot.media.length === 0) {
        return;
      }

      inFlight = true;
      adapter
        .awaitConfirmation()
        .then((permalink) => {
          deliver({
            version: 1,
            platform: adapter.platform,
            text,
            media: snapshot.media,
            permalink,
            sourceUrl: window.location.href,
            detectedAt: new Date().toISOString(),
          });
        })
        .catch(() => {
          // Confirmation failed -> treat as a non-event, do not deliver.
        })
        .finally(() => {
          inFlight = false;
        });
    } catch (error) {
      inFlight = false;
      console.debug("[outpost] detector submit handler error", error);
    }
  };

  // Capture phase so we observe the click before the site's own handler
  // potentially clears the composer.
  document.addEventListener("click", handleSubmit, true);
  document.addEventListener(
    "keydown",
    (event) => {
      const ke = event as KeyboardEvent;
      const isSubmitCombo = (ke.metaKey || ke.ctrlKey) && ke.key === "Enter";
      if (isSubmitCombo) {
        handleSubmit(event);
      }
    },
    true
  );
}

/**
 * Poll for a DOM element matching `selector` until it appears or the timeout
 * elapses. Resolves with the element or null. Used to confirm a post-success
 * affordance without leaking observers.
 */
export function waitForElement(
  selector: string,
  timeoutMs: number
): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }
    let settled = false;
    const finish = (value: Element | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        finish(found);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}
