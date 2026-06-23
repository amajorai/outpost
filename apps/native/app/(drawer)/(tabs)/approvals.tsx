/**
 * Approval inbox screen (U34): lists pending autopilot/experiment actions awaiting
 * a decision and lets the creator approve or reject each from their phone.
 *
 * Reads from `GET /api/companion/approvals` and writes decisions to
 * `POST /api/companion/approvals/:id/decision`. The desktop pushing its local
 * autopilot_actions here, and reconciling decisions back into local SQLite, is
 * the documented follow-up (see lib/companion-api.ts + the server router header).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, useThemeColor } from "heroui-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/container";
import {
  type ApprovalDecision,
  type CompanionApproval,
  decideApproval,
  listApprovals,
} from "@/lib/companion-api";

const APPROVALS_KEY = ["companion", "approvals"] as const;

function formatScheduledFor(scheduledFor: number | null): string {
  if (!scheduledFor) {
    return "Not scheduled";
  }
  return new Date(scheduledFor).toLocaleString();
}

function ApprovalCard({ item }: { item: CompanionApproval }) {
  const queryClient = useQueryClient();
  const dangerColor = useThemeColor("danger");
  const [pendingDecision, setPendingDecision] =
    useState<ApprovalDecision | null>(null);

  const mutation = useMutation({
    mutationFn: (decision: ApprovalDecision) =>
      decideApproval(item.id, decision),
    onMutate: (decision) => setPendingDecision(decision),
    onSettled: () => {
      setPendingDecision(null);
      queryClient.invalidateQueries({ queryKey: APPROVALS_KEY });
    },
  });

  return (
    <Card className="mb-4 p-4" variant="secondary">
      <View className="mb-2 flex-row items-center justify-between">
        <Chip size="sm">
          <Chip.Label>
            {item.kind === "autopilot" ? "Autopilot" : "Experiment"}
          </Chip.Label>
        </Chip>
        {item.targetPlatform ? (
          <Text className="text-muted text-xs uppercase">
            {item.targetPlatform}
          </Text>
        ) : null}
      </View>

      <Card.Title className="mb-1">{item.title}</Card.Title>
      <Text className="mb-3 text-foreground text-sm">{item.body}</Text>

      {item.rationale ? (
        <Text className="mb-3 text-muted text-xs italic">{item.rationale}</Text>
      ) : null}

      <Text className="mb-4 text-muted text-xs">
        {formatScheduledFor(item.scheduledFor)}
      </Text>

      <View className="flex-row gap-3">
        <Button
          className="flex-1"
          isDisabled={mutation.isPending}
          onPress={() => mutation.mutate("approved")}
        >
          {pendingDecision === "approved" ? (
            <ActivityIndicator size="small" />
          ) : (
            <Button.Label>Approve</Button.Label>
          )}
        </Button>
        <Button
          className="flex-1"
          isDisabled={mutation.isPending}
          onPress={() => mutation.mutate("rejected")}
          variant="ghost"
        >
          {pendingDecision === "rejected" ? (
            <ActivityIndicator color={dangerColor} size="small" />
          ) : (
            <Button.Label>Reject</Button.Label>
          )}
        </Button>
      </View>

      {mutation.isError ? (
        <Text className="mt-3 text-danger text-xs">
          {(mutation.error as Error).message}
        </Text>
      ) : null}
    </Card>
  );
}

export default function ApprovalsScreen() {
  const accentColor = useThemeColor("accent");
  const query = useQuery({
    queryKey: APPROVALS_KEY,
    queryFn: listApprovals,
  });

  return (
    <Container
      className="p-6"
      refreshControl={
        <RefreshControl
          onRefresh={() => query.refetch()}
          refreshing={query.isFetching && !query.isLoading}
        />
      }
    >
      <View className="mb-4">
        <Text className="font-bold text-3xl text-foreground">Approvals</Text>
        <Text className="mt-1 text-muted text-sm">
          Pending autopilot and experiment actions awaiting your call.
        </Text>
      </View>

      {query.isLoading ? (
        <View className="items-center py-12">
          <ActivityIndicator color={accentColor} size="large" />
        </View>
      ) : null}

      {query.isError ? (
        <Card className="p-4" variant="secondary">
          <Text className="text-danger text-sm">
            {(query.error as Error).message}
          </Text>
          <Pressable className="mt-3" onPress={() => query.refetch()}>
            <Text className="font-medium text-accent">Try again</Text>
          </Pressable>
        </Card>
      ) : null}

      {query.data && query.data.length === 0 ? (
        <Card className="items-center p-8" variant="secondary">
          <Text className="text-center text-muted">
            Nothing to approve right now.
          </Text>
          <Text className="mt-2 text-center text-muted text-xs">
            Autopilot actions proposed on your desktop will appear here once it
            syncs (follow-up).
          </Text>
        </Card>
      ) : null}

      {query.data?.map((item) => (
        <ApprovalCard item={item} key={item.id} />
      ))}
    </Container>
  );
}
