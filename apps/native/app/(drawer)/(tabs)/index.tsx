/**
 * Companion home tab (U34): greets the signed-in user and links to the two core
 * companion surfaces — approvals and compose. Sign-out lives here too.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button, Card, useThemeColor } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { listApprovals } from "@/lib/companion-api";

export default function Home() {
  const { data: session } = authClient.useSession();
  const accentColor = useThemeColor("accent");

  const approvals = useQuery({
    queryKey: ["companion", "approvals"],
    queryFn: listApprovals,
  });
  const pendingCount = approvals.data?.length ?? 0;

  return (
    <Container className="p-6">
      <View className="mb-6 py-2">
        <Text className="font-bold text-4xl text-foreground">Outpost</Text>
        {session?.user ? (
          <Text className="mt-1 text-muted text-sm">
            Signed in as {session.user.email}
          </Text>
        ) : null}
      </View>

      <Link asChild href="/(drawer)/(tabs)/approvals">
        <Card className="mb-4 p-4" variant="secondary">
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Card.Title>Approvals</Card.Title>
              <Text className="mt-1 text-muted text-sm">
                {pendingCount > 0
                  ? `${pendingCount} action${pendingCount === 1 ? "" : "s"} awaiting your call`
                  : "Review pending autopilot actions"}
              </Text>
            </View>
            <Ionicons color={accentColor} name="checkmark-done" size={28} />
          </View>
        </Card>
      </Link>

      <Link asChild href="/(drawer)/(tabs)/compose">
        <Card className="mb-4 p-4" variant="secondary">
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Card.Title>Compose</Card.Title>
              <Text className="mt-1 text-muted text-sm">
                Write a post and queue it for publishing
              </Text>
            </View>
            <Ionicons color={accentColor} name="create" size={28} />
          </View>
        </Card>
      </Link>

      <Button
        className="mt-2"
        onPress={() => authClient.signOut()}
        variant="ghost"
      >
        <Button.Label>Sign out</Button.Label>
      </Button>
    </Container>
  );
}
