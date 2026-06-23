/**
 * Drawer landing (U34). Auth is handled globally by AuthGate, so this is only
 * ever reached signed-in. It points into the companion tabs.
 */

import { Link } from "expo-router";
import { Button, Card } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";

export default function DrawerHome() {
  const { data: session } = authClient.useSession();

  return (
    <Container className="p-6">
      <View className="mb-6 py-4">
        <Text className="mb-2 font-bold text-4xl text-foreground">Outpost</Text>
        <Text className="text-muted text-sm">
          Your mobile companion for approvals and posting.
        </Text>
      </View>

      {session?.user ? (
        <Card className="mb-6 p-4" variant="secondary">
          <Text className="mb-1 text-base text-foreground">
            Welcome, {session.user.name}
          </Text>
          <Text className="mb-4 text-muted text-sm">{session.user.email}</Text>
          <Button onPress={() => authClient.signOut()} variant="ghost">
            <Button.Label>Sign out</Button.Label>
          </Button>
        </Card>
      ) : null}

      <Link asChild href="/(drawer)/(tabs)/approvals">
        <Button className="mb-3">
          <Button.Label>Open approvals</Button.Label>
        </Button>
      </Link>
      <Link asChild href="/(drawer)/(tabs)/compose">
        <Button variant="secondary">
          <Button.Label>Compose a post</Button.Label>
        </Button>
      </Link>
    </Container>
  );
}
