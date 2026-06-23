// X (twitter.com / x.com) detection adapter (Unit U18).
//
// Heuristics anchor on the compose box and its submit button, then confirm via
// the post-success toast whose "View" link carries a `/status/` permalink. This
// keeps feed tweets (which never trigger the composer submit flow) out of scope,
// holding false positives low.
//
// Selectors are X's current `data-testid` attributes; X iterates its DOM, so
// every lookup is null-guarded and confirmation failure simply suppresses
// delivery rather than throwing.
//
// TODO(U19): replies and quote tweets share the same composer, tweet button,
// and success toast, so they are detected as authored posts (correct - they are
// user-authored, not feed items). U19 may want to distinguish standalone posts
// from replies/quotes before cross-posting.

import type { DetectedMedia } from "../lib/detection";
import type {
  ComposeSnapshot,
  DetectionAdapter,
} from "../lib/detector-runtime";
import { startDetector, waitForElement } from "../lib/detector-runtime";

const TWEET_TEXTAREA_SELECTOR = '[data-testid^="tweetTextarea"]';
const TWEET_BUTTON_SELECTORS = [
  '[data-testid="tweetButton"]',
  '[data-testid="tweetButtonInline"]',
];
const TOAST_SELECTOR = '[data-testid="toast"]';
const STATUS_LINK_SELECTOR = 'a[href*="/status/"]';
const CONFIRMATION_TIMEOUT_MS = 6000;

const STATUS_PERMALINK_PATTERN = /\/status\/\d+/;

function readComposer(): ComposeSnapshot | null {
  const editors = Array.from(
    document.querySelectorAll<HTMLElement>(TWEET_TEXTAREA_SELECTOR)
  );
  if (editors.length === 0) {
    return null;
  }
  // The visible/focused composer is the authoring target; default to the last
  // one in the DOM, which is the active modal/inline composer in practice.
  const editor = editors.at(-1);
  if (!editor) {
    return null;
  }

  const text = (editor.textContent ?? "").trim();

  const media: DetectedMedia[] = [];
  const composerRoot =
    editor.closest('[data-testid="primaryColumn"]') ??
    editor.closest("form") ??
    document;
  const images = composerRoot.querySelectorAll<HTMLImageElement>(
    'img[src^="blob:"], [data-testid="attachments"] img'
  );
  for (const img of Array.from(images)) {
    media.push({
      previewUrl: img.src,
      altText: img.alt || undefined,
      kind: "image",
    });
  }
  const videos = composerRoot.querySelectorAll<HTMLVideoElement>("video[src]");
  for (const video of Array.from(videos)) {
    media.push({ previewUrl: video.src, kind: "video" });
  }

  return { text, media };
}

function isSubmitEvent(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    // Keyboard submit (Cmd/Ctrl+Enter) routes here with the editor as target
    // only sometimes; accept it as long as a composer is present.
    return document.querySelector(TWEET_TEXTAREA_SELECTOR) !== null;
  }
  for (const selector of TWEET_BUTTON_SELECTORS) {
    if (target.closest(selector)) {
      return true;
    }
  }
  // Keyboard submit from within the editor.
  return target.closest(TWEET_TEXTAREA_SELECTOR) !== null;
}

async function awaitConfirmation(): Promise<string | null> {
  const toast = await waitForElement(TOAST_SELECTOR, CONFIRMATION_TIMEOUT_MS);
  if (!toast) {
    // No success toast appeared: do not confirm the post.
    throw new Error("no confirmation toast");
  }
  const link = toast.querySelector<HTMLAnchorElement>(STATUS_LINK_SELECTOR);
  if (link && STATUS_PERMALINK_PATTERN.test(link.href)) {
    return link.href;
  }
  return null;
}

const adapter: DetectionAdapter = {
  platform: "x",
  readComposer,
  isSubmitEvent,
  awaitConfirmation,
};

export default defineContentScript({
  matches: ["*://twitter.com/*", "*://x.com/*"],
  main() {
    startDetector(adapter);
  },
});
