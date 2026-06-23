import { useEffect } from "react";
import { startScheduler } from "@/lib/scheduler/scheduler";

/**
 * Starts the local scheduler once at app startup. `startScheduler` is itself a
 * module-level singleton, so this is safe under React StrictMode's
 * double-invoked effects; the effect cleanup intentionally does NOT stop the
 * scheduler, because the scheduler should run for the whole app lifetime, not
 * be torn down on a StrictMode remount.
 */
export function useScheduler(): void {
  useEffect(() => {
    startScheduler();
  }, []);
}
