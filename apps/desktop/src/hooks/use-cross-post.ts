import { useEffect } from "react";
import { startCrossPostListener } from "@/lib/cross-post/listener";

/**
 * Starts the detected-post cross-post listener once at app startup.
 * `startCrossPostListener` is a module-level singleton (guarded against the
 * in-flight async `listen()` window too), so this is safe under React
 * StrictMode's double-invoked effects. The cleanup intentionally does NOT stop
 * the listener: it should stay subscribed for the whole app lifetime, like the
 * scheduler and publish runner.
 */
export function useCrossPost(): void {
  useEffect(() => {
    startCrossPostListener().catch(() => {
      // startCrossPostListener logs its own errors
    });
  }, []);
}
