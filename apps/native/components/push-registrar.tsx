/**
 * Registers this device for push notifications once the user is signed in, and
 * wires the approval-tap deep link (U34). Renders nothing.
 */

import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";
import {
  addApprovalNotificationListener,
  registerForPushNotifications,
} from "@/lib/push-notifications";

export function PushRegistrar() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) {
      return;
    }
    // Token registration is best-effort and self-contained (never throws),
    // but guard anyway so a rejected promise can't surface as unhandled.
    registerForPushNotifications().catch(() => {
      // ignored: push is optional and must not block app usage
    });
    const unsubscribe = addApprovalNotificationListener();
    return unsubscribe;
  }, [userId]);

  return null;
}
