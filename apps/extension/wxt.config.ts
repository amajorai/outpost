import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Outpost",
    description: "Detects your manual posts and delivers them to Outpost.",
    permissions: [],
    // Content-script match origins plus the local desktop bridge. The bridge
    // host permission is required for the background service worker to POST
    // detections to http://localhost:37842.
    host_permissions: [
      "*://twitter.com/*",
      "*://x.com/*",
      "*://*.linkedin.com/*",
      "http://localhost:37842/*",
    ],
  },
});
