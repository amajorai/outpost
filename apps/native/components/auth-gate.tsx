/**
 * Auth gate (U34): blocks the whole app behind a better-auth session.
 *
 * While the session is loading we show a spinner; with no signed-in user we show
 * the sign-in / sign-up screen; only an authenticated user reaches `children`.
 * This is the real gate the acceptance criteria require — not a conditional card
 * layered over otherwise-reachable screens.
 */

import { useThemeColor } from "heroui-native";
import type { PropsWithChildren } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { authClient } from "@/lib/auth-client";

export function AuthGate({ children }: PropsWithChildren) {
  const { data: session, isPending } = authClient.useSession();
  const accentColor = useThemeColor("accent");
  const insets = useSafeAreaInsets();

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={accentColor} size="large" />
      </View>
    );
  }

  if (session?.user) {
    return <>{children}</>;
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View className="mb-2">
        <Text className="font-bold text-4xl text-foreground">Outpost</Text>
        <Text className="mt-2 text-base text-muted">
          Sign in to approve autopilot actions and post from your phone.
        </Text>
      </View>
      <SignIn />
      <SignUp />
    </ScrollView>
  );
}
