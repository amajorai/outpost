/**
 * Expo push-notification wiring for the companion app (U34).
 *
 * Client side is REAL: we set the foreground handler, request permission, fetch
 * the Expo push token, and register it with the server (`/push-token`). When an
 * "approval-needed" notification arrives, the response handler deep-links to the
 * approval inbox.
 *
 * Server side is the documented FOLLOW-UP: actually SENDING a push (via Expo's
 * push service) when an approval lands. The desktop -> server -> Expo push fan-out
 * needs the desktop to push approvals first (see companion router header).
 */

// biome-ignore lint/performance/noNamespaceImport: expo-device only exposes a namespace API
import * as Device from "expo-device";
// biome-ignore lint/performance/noNamespaceImport: expo-notifications only exposes a namespace API
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";

import { registerPushToken } from "@/lib/companion-api";

/** Data payload the server attaches to an approval-needed push. */
const APPROVAL_NOTIFICATION_TYPE = "approval-needed";

/**
 * Foreground presentation: show the banner + list it even when the app is open,
 * so an approval request isn't silently swallowed while the user is in-app.
 */
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
});

/**
 * Request permission, get the Expo push token, and register it server-side.
 * Returns the token on success, or null when unavailable (simulator, denied
 * permission, or registration failed). Never throws — push is best-effort and
 * must not block app usage.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push tokens are only issued on physical devices.
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("approvals", {
      name: "Approvals",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") {
    return null;
  }

  let token: string;
  try {
    const projectId = await getProjectId();
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    token = result.data;
  } catch {
    return null;
  }

  const platform = resolvePushPlatform();

  try {
    await registerPushToken(token, platform);
  } catch {
    // Registration failed (e.g. offline / not signed in yet). The token is
    // still valid locally; a later session can re-register.
    return token;
  }

  return token;
}

function resolvePushPlatform(): "ios" | "android" | "web" {
  if (Platform.OS === "android") {
    return "android";
  }
  if (Platform.OS === "web") {
    return "web";
  }
  return "ios";
}

async function getProjectId(): Promise<string | undefined> {
  const Constants = (await import("expo-constants")).default;
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    undefined
  );
}

/**
 * Wire the tap handler: when the user taps an approval-needed notification, jump
 * to the approval inbox. Returns an unsubscribe function for cleanup.
 */
export function addApprovalNotificationListener(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const type = response.notification.request.content.data?.type;
      if (type === APPROVAL_NOTIFICATION_TYPE) {
        router.navigate("/(drawer)/(tabs)/approvals");
      }
    }
  );
  return () => subscription.remove();
}
