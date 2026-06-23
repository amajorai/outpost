/**
 * The Templates section's main panel (U16).
 *
 * Two concerns share this surface:
 *
 * 1. Templates CRUD — create, edit, and delete reusable post templates (a name
 *    plus a body). Templates are applied into the composer from the composer's
 *    own Templates dialog; this panel owns authoring them.
 * 2. Voice profile — a "Learn my voice" card that derives a writing-voice
 *    profile from the user's past posts via the ACP agent and persists it. The
 *    reformat flow reads that profile to condition AI output when present.
 *
 * Loading mirrors the other panels: refresh on mount, render from local state /
 * the voice store.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Textarea } from "@repo/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Pencil, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { platformLabel } from "@/components/compose/platform-meta";
import { getSectionMeta } from "@/components/nav/sections";
import {
  decodeTemplateBody,
  deleteTemplate,
  emptyTemplateBody,
  listTemplates,
  saveTemplate,
} from "@/lib/repos/templates";
import type { Template } from "@/lib/social-schema";
import { voiceDeriveFailureMessage } from "@/lib/voice/derive";
import { SUPPORTED_PLATFORMS } from "@/stores/use-social-accounts-store";
import { useVoiceProfileStore } from "@/stores/use-voice-profile-store";

interface TemplateEditorProps {
  /** The template being edited, or null to create a new one. */
  template: Template | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function TemplateEditor({
  template,
  open,
  onOpenChange,
  onSaved,
}: TemplateEditorProps) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  // Per-platform default overrides, keyed by platform. Empty strings are
  // dropped on save by encodeTemplateBody, so a blank field means "no override".
  const [platformDefaults, setPlatformDefaults] = useState<
    Record<string, string>
  >({});
  const [showDefaults, setShowDefaults] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Seed the fields whenever the dialog opens for a (possibly different) target.
  useEffect(() => {
    if (open) {
      const decoded = template
        ? decodeTemplateBody(template.body)
        : emptyTemplateBody();
      setName(template?.name ?? "");
      setText(decoded.text);
      const defaults = decoded.platformDefaults ?? {};
      setPlatformDefaults(defaults);
      setShowDefaults(Object.keys(defaults).length > 0);
    }
  }, [open, template]);

  const canSave = name.trim().length > 0 && !isSaving;

  const setPlatformDefault = useCallback((platform: string, value: string) => {
    setPlatformDefaults((current) => ({ ...current, [platform]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (name.trim().length === 0) {
      return;
    }
    setIsSaving(true);
    try {
      await saveTemplate({
        id: template?.id,
        name,
        body: { ...emptyTemplateBody(), text, platformDefaults },
      });
      toast(template ? "Template updated" : "Template created");
      onOpenChange(false);
      onSaved();
    } catch {
      toast("Could not save the template");
    } finally {
      setIsSaving(false);
    }
  }, [name, text, platformDefaults, template, onOpenChange, onSaved]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit template" : "New template"}
          </DialogTitle>
          <DialogDescription>
            A reusable starting point you can apply to a post from the composer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-sm" htmlFor="template-name">
              Name
            </label>
            <Input
              id="template-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Launch announcement"
              value={name}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-sm" htmlFor="template-body">
              Body
            </label>
            <Textarea
              id="template-body"
              onChange={(event) => setText(event.target.value)}
              placeholder="Write the template body…"
              rows={6}
              value={text}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Button
              className="self-start"
              onClick={() => setShowDefaults((value) => !value)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {showDefaults
                ? "Hide platform defaults"
                : "Add platform defaults (optional)"}
            </Button>
            {showDefaults ? (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                <p className="text-muted-foreground text-xs">
                  Optional per-platform body. When you apply this template, a
                  platform with a default seeds that platform's variant; the
                  rest fall back to the body above.
                </p>
                {SUPPORTED_PLATFORMS.map((platform) => (
                  <div className="flex flex-col gap-1" key={platform}>
                    <label
                      className="font-medium text-xs"
                      htmlFor={`template-default-${platform}`}
                    >
                      {platformLabel(platform)}
                    </label>
                    <Textarea
                      id={`template-default-${platform}`}
                      onChange={(event) =>
                        setPlatformDefault(platform, event.target.value)
                      }
                      placeholder={`Override for ${platformLabel(platform)}…`}
                      rows={2}
                      value={platformDefaults[platform] ?? ""}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            }
          />
          <Button disabled={!canSave} onClick={handleSave} type="button">
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoiceProfileCard() {
  const profile = useVoiceProfileStore((s) => s.profile);
  const isLoading = useVoiceProfileStore((s) => s.isLoading);
  const isDeriving = useVoiceProfileStore((s) => s.isDeriving);
  const load = useVoiceProfileStore((s) => s.load);
  const derive = useVoiceProfileStore((s) => s.derive);
  const clear = useVoiceProfileStore((s) => s.clear);

  useEffect(() => {
    load();
  }, [load]);

  const handleDerive = useCallback(async () => {
    const result = await derive();
    if (result.failure) {
      toast(voiceDeriveFailureMessage(result.failure));
      return;
    }
    toast(`Learned your voice from ${result.profile?.sampleCount ?? 0} posts.`);
  }, [derive]);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-sm">
          <Sparkles className="size-4 text-muted-foreground" />
          Your writing voice
        </span>
        <div className="flex items-center gap-2">
          {profile ? (
            <Button
              disabled={isDeriving}
              onClick={() => clear()}
              size="sm"
              type="button"
              variant="ghost"
            >
              Clear
            </Button>
          ) : null}
          <Button
            disabled={isDeriving || isLoading}
            onClick={handleDerive}
            size="sm"
            type="button"
            variant="outline"
          >
            {isDeriving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {profile ? "Re-learn" : "Learn my voice"}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Outpost studies your past posts to learn your tone, length, and hooks,
        then uses that voice when reformatting posts for each platform.
      </p>
      {profile ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed">{profile.summary}</p>
          {profile.traits.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {profile.traits.map((trait) => (
                <Badge key={trait} variant="secondary">
                  {trait}
                </Badge>
              ))}
            </div>
          ) : null}
          <span className="text-muted-foreground text-xs">
            From {profile.sampleCount}{" "}
            {profile.sampleCount === 1 ? "post" : "posts"}
            {profile.derivedAt > 0
              ? `, ${formatDistanceToNow(new Date(profile.derivedAt), {
                  addSuffix: true,
                })}`
              : ""}
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {isLoading
            ? "Loading…"
            : "No voice profile yet. Learn your voice once you've written a few posts."}
        </p>
      )}
    </section>
  );
}

export function TemplatesPanel() {
  const { label, description } = getSectionMeta("templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setTemplates(await listTemplates());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleNew = useCallback(() => {
    setEditing(null);
    setEditorOpen(true);
  }, []);

  const handleEdit = useCallback((template: Template) => {
    setEditing(template);
    setEditorOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      const removed = await deleteTemplate(id);
      if (removed) {
        toast("Template deleted");
        refresh();
      }
    },
    [refresh]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl tracking-tight">{label}</h1>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
          <Button onClick={handleNew} size="sm" type="button">
            <Plus className="size-4" />
            New template
          </Button>
        </header>

        <VoiceProfileCard />

        <div className="flex flex-col gap-2">
          <span className="font-medium text-sm">Templates</span>
          {isLoading && templates.length === 0 ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : null}
          {!isLoading && templates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Wand2 className="size-6" strokeWidth={1.5} />
              </div>
              <p className="max-w-sm text-balance text-muted-foreground text-sm">
                No templates yet. Create a reusable starting point to write
                faster.
              </p>
            </div>
          ) : null}
          <ul className="flex flex-col gap-2">
            {templates.map((template) => (
              <li
                className="flex items-start justify-between gap-3 rounded-lg border bg-card p-4"
                key={template.id}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium text-sm">{template.name}</span>
                  <span className="line-clamp-2 text-muted-foreground text-sm">
                    {decodeTemplateBody(template.body).text || "Empty template"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    aria-label={`Edit ${template.name}`}
                    onClick={() => handleEdit(template)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    aria-label={`Delete ${template.name}`}
                    onClick={() => handleDelete(template.id)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <TemplateEditor
        onOpenChange={setEditorOpen}
        onSaved={refresh}
        open={editorOpen}
        template={editing}
      />
    </section>
  );
}
