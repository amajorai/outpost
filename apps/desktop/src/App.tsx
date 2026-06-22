import { useEffect, useRef } from "react";
import { LicenseActivation } from "@/components/LicenseActivation";
import { TitleBar } from "@/components/TitleBar";
import { Toaster } from "@/components/ui/sonner";
import { VersionGateModal } from "@/components/VersionGateModal";
import { useAppUpdater } from "@/hooks/use-app-updater";
import { useWindowBounds } from "@/hooks/use-window-bounds";
import { setAxiomLoggingEnabled } from "@/lib/logger";
import { runMigrations } from "@/lib/migration";
import { initPostHog } from "@/lib/posthog";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";
import { useLicenseStore } from "@/stores/use-license-store";

function UpdateChecker() {
  useAppUpdater();
  return null;
}

function WindowBoundsManager() {
  useWindowBounds();
  return null;
}

export default function App() {
  // Latches true once the app first renders its main UI. The full-screen loader
  // is only for the initial load; an in-flight `isValidating` from an
  // interactive license activation must NOT tear the tree down and remount it
  // (that re-runs window-bounds restore, which un-maximizes the window).
  const hasPassedInitialLoadRef = useRef(false);

  const {
    isValidated,
    isValidating,
    loadStoredLicense,
    gateOpen: licenseGateOpen,
    closeLicenseGate,
  } = useLicenseStore();

  const { loadSettings, isInitialLoadDone, analyticsEnabled, loggingEnabled } =
    useAppSettingsStore();

  useEffect(() => {
    // App-data migration must finish first — it moves files from the old
    // `pub.youtube.desktop` appdata dir to the current one. Reading the
    // license/settings before it completes can show a freshly-installed user
    // as unlicensed on upgrade from the rebranded build.
    (async () => {
      try {
        await runMigrations();
      } catch {
        // best-effort migration; still load license/settings
      }
      loadStoredLicense();
      loadSettings();
    })();
  }, [loadStoredLicense, loadSettings]);

  useEffect(() => {
    if (!isInitialLoadDone) {
      return;
    }
    initPostHog(analyticsEnabled);
    setAxiomLoggingEnabled(loggingEnabled);
  }, [isInitialLoadDone, analyticsEnabled, loggingEnabled]);

  const showInitialLoading =
    !isInitialLoadDone || (isValidating && !isValidated);
  if (showInitialLoading && !hasPassedInitialLoadRef.current) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted">
        <div className="flex flex-col items-center gap-4">
          <div className="size-8 animate-spin rounded-full border-4 border-foreground border-t-transparent" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }
  hasPassedInitialLoadRef.current = true;

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col bg-muted">
      <TitleBar />
      <main className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Outpost</p>
      </main>
      {licenseGateOpen && !isValidated && (
        <div className="fixed inset-0 z-[1100]">
          <LicenseActivation onBack={closeLicenseGate} />
        </div>
      )}
      <Toaster />
      <UpdateChecker />
      <VersionGateModal />
      <WindowBoundsManager />
    </div>
  );
}
