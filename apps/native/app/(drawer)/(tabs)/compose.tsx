/**
 * Compose + publish screen (U34): write a post, pick platforms, and submit.
 *
 * Submits to `POST /api/companion/posts`, which queues the post for the desktop
 * to publish through its real provider pipeline (the desktop holds the
 * OAuth/Composio credentials, so the actual network publish happens there — see
 * the server router header). The phone is the compose + queue surface.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, TextField } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { createPost } from "@/lib/companion-api";

/** Platform keys mirror the desktop provider registry (lib/providers/types.ts). */
const PLATFORMS = [
  { key: "x", label: "X" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "bluesky", label: "Bluesky" },
  { key: "threads", label: "Threads" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "reddit", label: "Reddit" },
] as const;

const POSTS_KEY = ["companion", "posts"] as const;

export default function ComposeScreen() {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<string[]>(["x"]);
  const [justQueued, setJustQueued] = useState(false);

  const mutation = useMutation({
    mutationFn: () => createPost({ body: body.trim(), platforms: selected }),
    onSuccess: () => {
      setBody("");
      setJustQueued(true);
      queryClient.invalidateQueries({ queryKey: POSTS_KEY });
    },
  });

  function togglePlatform(key: string) {
    setJustQueued(false);
    setSelected((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key]
    );
  }

  const canSubmit =
    body.trim().length > 0 && selected.length > 0 && !mutation.isPending;

  return (
    <Container className="p-6">
      <View className="mb-4">
        <Text className="font-bold text-3xl text-foreground">Compose</Text>
        <Text className="mt-1 text-muted text-sm">
          Write a post and queue it for publishing.
        </Text>
      </View>

      <Card className="mb-4 p-4" variant="secondary">
        <TextField>
          <TextField.Input
            multiline
            numberOfLines={6}
            onChangeText={(text) => {
              setBody(text);
              setJustQueued(false);
            }}
            placeholder="What do you want to share?"
            style={{ minHeight: 120, textAlignVertical: "top" }}
            value={body}
          />
        </TextField>
        <Text className="mt-2 text-muted text-xs">
          {body.length} characters
        </Text>
      </Card>

      <Text className="mb-2 font-medium text-foreground text-sm">
        Platforms
      </Text>
      <View className="mb-6 flex-row flex-wrap gap-2">
        {PLATFORMS.map((platform) => {
          const isSelected = selected.includes(platform.key);
          return (
            <Pressable
              key={platform.key}
              onPress={() => togglePlatform(platform.key)}
            >
              <Chip color={isSelected ? "accent" : "default"} size="md">
                <Chip.Label>{platform.label}</Chip.Label>
              </Chip>
            </Pressable>
          );
        })}
      </View>

      <Button isDisabled={!canSubmit} onPress={() => mutation.mutate()}>
        {mutation.isPending ? (
          <ActivityIndicator size="small" />
        ) : (
          <Button.Label>Queue post</Button.Label>
        )}
      </Button>

      {justQueued ? (
        <Text className="mt-3 text-center text-sm text-success">
          Queued. Your desktop will publish it through the provider pipeline.
        </Text>
      ) : null}

      {mutation.isError ? (
        <Text className="mt-3 text-center text-danger text-sm">
          {(mutation.error as Error).message}
        </Text>
      ) : null}

      <Text className="mt-6 text-center text-muted text-xs">
        Posts are queued on the server. Actual publishing runs on your desktop,
        which holds your connected-account credentials.
      </Text>
    </Container>
  );
}
