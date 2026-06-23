import { useEffect, useRef } from "react";
import { LicenseActivation } from "@/components/LicenseActivation";
import { AppShell } from "@/components/nav/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { VersionGateModal } from "@/components/VersionGateModal";
import { useAppUpdater } from "@/hooks/use-app-updater";
import { usePublishRunner } from "@/hooks/use-publish-runner";
import { useScheduler } from "@/hooks/use-scheduler";
import { useWindowBounds } from "@/hooks/use-window-bounds";
import { setAxiomLoggingEnabled } from "@/lib/logger";
import { initPostHog } from "@/lib/posthog";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";
import { useLicenseStore } from "@/stores/use-license-store";
import { useNavigationStore } from "@/stores/use-navigation-store";

function UpdateChecker() {
  useAppUpdater();
  return null;
}

function WindowBoundsManager() {
  useWindowBounds();
  return null;
}

function PublishRunnerManager() {
  usePublishRunner();
  return null;
}

function SchedulerManager() {
  useScheduler();
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

  const loadNavigation = useNavigationStore((s) => s.loadNavigation);
  const navInitialLoadDone = useNavigationStore((s) => s.isInitialLoadDone);

  useEffect(() => {
    loadStoredLicense();
    loadSettings();
    loadNavigation();
  }, [loadStoredLicense, loadSettings, loadNavigation]);

  useEffect(() => {
    if (!isInitialLoadDone) {
      return;
    }
    initPostHog(analyticsEnabled);
    setAxiomLoggingEnabled(loggingEnabled);
  }, [isInitialLoadDone, analyticsEnabled, loggingEnabled]);

  const showInitialLoading =
    !(isInitialLoadDone && navInitialLoadDone) ||
    (isValidating && !isValidated);
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
    <>
      <AppShell />
      {licenseGateOpen && !isValidated && (
        <div className="fixed inset-0 z-[1100]">
          <LicenseActivation onBack={closeLicenseGate} />
        </div>
      )}
      <Toaster />
      <UpdateChecker />
      <VersionGateModal />
      <WindowBoundsManager />
      <PublishRunnerManager />
      <SchedulerManager />
    </>
  );
}
