import { useEffect } from "react";
import { startPublishRunner } from "@/lib/publish/runner";

/**
 * Starts the publish runner once at app startup. `startPublishRunner` is a
 * module-level singleton, so this is safe under React StrictMode's
 * double-invoked effects. The cleanup intentionally does NOT stop the runner:
 * it should subscribe for the whole app lifetime, not be torn down on a
 * StrictMode remount.
 *
 * Render this BEFORE the scheduler manager so the runner's `onDue` subscription
 * is in place before the scheduler's launch catch-up sweep emits. The runner
 * also drains `getDuePosts()` on start as a safety net for any race.
 */
export function usePublishRunner(): void {
  useEffect(() => {
    startPublishRunner();
  }, []);
}
