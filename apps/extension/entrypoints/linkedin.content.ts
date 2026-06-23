// LinkedIn (linkedin.com) detection adapter (Unit U18).
//
// Heuristics anchor on the share-box Quill editor and its "Post" button, then
// confirm via the artdeco success toast whose link carries a
// `/feed/update/urn:li:activity:` permalink. Feed posts authored by other users
// never enter this compose/submit flow, keeping false positives low.
//
// LinkedIn rotates obfuscated class names but keeps stable structural hooks
// (`.ql-editor`, `aria-label` text). Every lookup is null-guarded; confirmation
// failure suppresses delivery rather than throwing.

import type { DetectedMedia } from "../lib/detection";
import type {
  ComposeSnapshot,
  DetectionAdapter,
} from "../lib/detector-runtime";
import { startDetector, waitForElement } from "../lib/detector-runtime";

const EDITOR_SELECTOR = '.ql-editor[contenteditable="true"]';
const POST_BUTTON_SELECTOR =
  ".share-actions__primary-action, .share-box_actions button[class*='primary']";
const TOAST_SELECTOR = ".artdeco-toast-item, [data-test-artdeco-toast-item]";
const ACTIVITY_LINK_SELECTOR = 'a[href*="/feed/update/urn:li:activity:"]';
const CONFIRMATION_TIMEOUT_MS = 8000;

const ACTIVITY_PERMALINK_PATTERN = /\/feed\/update\/urn:li:activity:\d+/;
const POST_BUTTON_LABEL_PATTERN = /^post$/i;

function isPostButton(el: Element): boolean {
  if (el.matches(POST_BUTTON_SELECTOR)) {
    return true;
  }
  const button = el.closest("button");
  if (!button) {
    return false;
  }
  if (button.matches(POST_BUTTON_SELECTOR)) {
    return true;
  }
  const label = button.getAttribute("aria-label") ?? button.textContent ?? "";
  return POST_BUTTON_LABEL_PATTERN.test(label.trim());
}

function readComposer(): ComposeSnapshot | null {
  const editor = document.querySelector<HTMLElement>(EDITOR_SELECTOR);
  if (!editor) {
    return null;
  }

  const text = (editor.innerText ?? editor.textContent ?? "").trim();

  const media: DetectedMedia[] = [];
  const shareBox =
    editor.closest(".share-box") ??
    editor.closest('[role="dialog"]') ??
    document;
  const images = shareBox.querySelectorAll<HTMLImageElement>(
    'img[src^="blob:"], .share-images img, [class*="image-preview"] img'
  );
  for (const img of Array.from(images)) {
    media.push({
      previewUrl: img.src,
      altText: img.alt || undefined,
      kind: "image",
    });
  }
  const videos = shareBox.querySelectorAll<HTMLVideoElement>("video[src]");
  for (const video of Array.from(videos)) {
    media.push({ previewUrl: video.src, kind: "video" });
  }

  return { text, media };
}

function isSubmitEvent(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return document.querySelector(EDITOR_SELECTOR) !== null;
  }
  if (isPostButton(target)) {
    return true;
  }
  return target.closest(EDITOR_SELECTOR) !== null;
}

async function awaitConfirmation(): Promise<string | null> {
  const toast = await waitForElement(TOAST_SELECTOR, CONFIRMATION_TIMEOUT_MS);
  if (!toast) {
    throw new Error("no confirmation toast");
  }
  const link = toast.querySelector<HTMLAnchorElement>(ACTIVITY_LINK_SELECTOR);
  if (link && ACTIVITY_PERMALINK_PATTERN.test(link.href)) {
    return link.href;
  }
  return null;
}

const adapter: DetectionAdapter = {
  platform: "linkedin",
  readComposer,
  isSubmitEvent,
  awaitConfirmation,
};

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    startDetector(adapter);
  },
});
