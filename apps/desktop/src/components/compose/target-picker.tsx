/**
 * Account target picker for the composer (U8).
 *
 * Lists connected accounts as toggleable chips. Accounts whose platform can't
 * publish (per the provider capability matrix) are disabled with a reason, so the
 * composer never offers an unpublishable target.
 */

import { Checkbox } from "@repo/ui/checkbox";
import { platformLabel } from "@/components/compose/platform-meta";
import type { CapabilityMatrix, Platform } from "@/lib/providers";
import type { SocialAccount } from "@/lib/social-schema";

function canPublish(
  matrix: CapabilityMatrix | null,
  platform: string
): boolean {
  if (!matrix) {
    // Until the matrix resolves, don't block selection.
    return true;
  }
  return matrix[platform as Platform]?.publish ?? false;
}

export function TargetPicker({
  accounts,
  selectedAccountIds,
  capabilityMatrix,
  onToggle,
}: {
  accounts: SocialAccount[];
  selectedAccountIds: string[];
  capabilityMatrix: CapabilityMatrix | null;
  onToggle: (accountId: string) => void;
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No accounts connected yet. Connect an account in Settings to choose
        where to post.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {accounts.map((account) => {
        const publishable = canPublish(capabilityMatrix, account.platform);
        const selected = selectedAccountIds.includes(account.id);
        const inputId = `target-${account.id}`;
        return (
          <label
            className={
              publishable
                ? "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors has-data-checked:border-primary has-data-checked:bg-primary/10"
                : "flex cursor-not-allowed items-center gap-2 rounded-full border px-3 py-1.5 text-sm opacity-50"
            }
            htmlFor={inputId}
            key={account.id}
            title={
              publishable
                ? undefined
                : `${platformLabel(account.platform)} can't publish with the current provider`
            }
          >
            <Checkbox
              checked={selected}
              disabled={!publishable}
              id={inputId}
              onCheckedChange={() => onToggle(account.id)}
            />
            <span className="font-medium">{account.accountLabel}</span>
            <span className="text-muted-foreground text-xs">
              {platformLabel(account.platform)}
            </span>
          </label>
        );
      })}
    </div>
  );
}
