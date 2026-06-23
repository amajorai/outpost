/**
 * The Pipeline section's main panel (U33): a content production kanban.
 *
 * A board of five fixed production stages (idea -> script -> record -> edit ->
 * publish). Each card is a content idea you can:
 *  - create (the add form seeds an `idea`),
 *  - move forward/back a stage (buttons; drag is intentionally out of scope),
 *  - edit (a dialog over the card's title, notes, and body text),
 *  - delete, and
 *  - promote into a draft + open it in the composer (saveDraft -> loadDraft ->
 *    switch to Compose), so a finished card flows straight into the publish path.
 *
 * Loading mirrors `MoneyPanel`: refresh on mount, render from the store. The
 * store owns the board's data; the promote flow lives here because it touches the
 * composer + navigation stores.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  KanbanSquare,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSectionMeta } from "@/components/nav/sections";
import {
  decodeDraftBody,
  emptyDraftBody,
  encodeDraftBody,
  saveDraft,
} from "@/lib/repos/drafts";
import type { ContentItem, ContentStage } from "@/lib/social-schema";
import { useComposerStore } from "@/stores/use-composer-store";
import { useNavigationStore } from "@/stores/use-navigation-store";
import { usePipelineStore } from "@/stores/use-pipeline-store";

const STAGES: readonly { value: ContentStage; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "script", label: "Script" },
  { value: "record", label: "Record" },
  { value: "edit", label: "Edit" },
  { value: "publish", label: "Publish" },
];

function stageAt(offset: number, stage: ContentStage): ContentStage | null {
  const index = STAGES.findIndex((s) => s.value === stage);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= STAGES.length) {
    return null;
  }
  return STAGES[target].value;
}

/** Read a card's body JSON into its decoded post text. */
function cardBodyText(body: string): string {
  return decodeDraftBody(body).text;
}

/** Build a card body JSON blob from plain post text. */
function bodyFromText(text: string): string {
  return encodeDraftBody({
    ...emptyDraftBody(),
    text,
    segments: [{ text, media: [] }],
  });
}

function AddCardForm() {
  const addItem = usePipelineStore((s) => s.addItem);
  const [title, setTitle] = useState("");

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    await addItem({ title: trimmed });
    setTitle("");
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <label className="font-medium text-xs" htmlFor="pipeline-title">
          New idea
        </label>
        <Input
          id="pipeline-title"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Behind-the-scenes of the new launch"
          value={title}
        />
      </div>
      <Button size="sm" type="submit">
        <Plus className="size-4" />
        Add card
      </Button>
    </form>
  );
}

function EditCardDialog({
  item,
  onClose,
}: {
  item: ContentItem;
  onClose: () => void;
}) {
  const editItem = usePipelineStore((s) => s.editItem);
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [body, setBody] = useState(() => cardBodyText(item.body));

  const submit = async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      return;
    }
    await editItem(item.id, {
      title: trimmedTitle,
      notes: notes.trim() || null,
      body: bodyFromText(body),
    });
    onClose();
  };

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit card</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <label className="font-medium text-xs" htmlFor="edit-card-title">
              Title
            </label>
            <Input
              id="edit-card-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-xs" htmlFor="edit-card-notes">
              Notes
            </label>
            <textarea
              className="min-h-16 rounded-md border border-input bg-transparent p-2 text-sm"
              id="edit-card-notes"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Production notes"
              value={notes}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-xs" htmlFor="edit-card-body">
              Post body
            </label>
            <textarea
              className="min-h-24 rounded-md border border-input bg-transparent p-2 text-sm"
              id="edit-card-body"
              onChange={(event) => setBody(event.target.value)}
              placeholder="The draft this card becomes when promoted"
              value={body}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PipelineCard({ item }: { item: ContentItem }) {
  const moveItem = usePipelineStore((s) => s.moveItem);
  const removeItem = usePipelineStore((s) => s.removeItem);
  const loadDraft = useComposerStore((s) => s.loadDraft);
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);
  const [isEditing, setIsEditing] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);

  const prev = stageAt(-1, item.stage);
  const next = stageAt(1, item.stage);
  const bodyPreview = useMemo(() => cardBodyText(item.body), [item.body]);

  const promote = async () => {
    setIsPromoting(true);
    try {
      // Persist a draft from the card's body, then bind the composer to that
      // saved draft (loadDraft) before switching to Compose, so the just-saved
      // draft isn't orphaned and edits in the composer update the same row.
      const saved = await saveDraft({ body: decodeDraftBody(item.body) });
      await loadDraft(saved.id);
      await setActiveSection("compose");
    } finally {
      setIsPromoting(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sm">{item.title}</span>
        <Button
          aria-label={`Edit ${item.title}`}
          className="size-7 shrink-0"
          onClick={() => setIsEditing(true)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
      {bodyPreview ? (
        <p className="line-clamp-3 text-muted-foreground text-xs">
          {bodyPreview}
        </p>
      ) : null}
      {item.notes ? (
        <p className="line-clamp-2 text-muted-foreground/80 text-xs italic">
          {item.notes}
        </p>
      ) : null}
      <div className="flex items-center gap-1">
        <Button
          aria-label="Move back a stage"
          className="size-7"
          disabled={!prev}
          onClick={() => prev && moveItem(item.id, prev)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button
          aria-label="Move forward a stage"
          className="size-7"
          disabled={!next}
          onClick={() => next && moveItem(item.id, next)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <Button
          aria-label={`Promote ${item.title} into a draft`}
          className="h-7 px-2 text-xs"
          disabled={isPromoting}
          onClick={promote}
          size="sm"
          type="button"
          variant="ghost"
        >
          {isPromoting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Promote
        </Button>
        <Button
          aria-label={`Delete ${item.title}`}
          className="ml-auto size-7"
          onClick={() => removeItem(item.id)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {isEditing ? (
        <EditCardDialog item={item} onClose={() => setIsEditing(false)} />
      ) : null}
    </li>
  );
}

function PipelineBoard({ items }: { items: ContentItem[] }) {
  const byStage = useMemo(() => {
    const map = new Map<ContentStage, ContentItem[]>();
    for (const stage of STAGES) {
      map.set(stage.value, []);
    }
    for (const item of items) {
      map.get(item.stage)?.push(item);
    }
    return map;
  }, [items]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {STAGES.map((stage) => {
        const column = byStage.get(stage.value) ?? [];
        return (
          <div className="flex flex-col gap-2" key={stage.value}>
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">{stage.label}</h3>
              <Badge variant="outline">{column.length}</Badge>
            </div>
            <ul className="flex flex-col gap-2">
              {column.map((item) => (
                <PipelineCard item={item} key={item.id} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function PipelinePanel() {
  const { label, description } = getSectionMeta("pipeline");
  const items = usePipelineStore((s) => s.items);
  const isLoading = usePipelineStore((s) => s.isLoading);
  const error = usePipelineStore((s) => s.error);
  const refresh = usePipelineStore((s) => s.refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="flex items-start justify-between gap-4 pb-4">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <KanbanSquare className="size-4 text-muted-foreground" />
            <h2 className="font-medium text-sm">Production board</h2>
          </div>
          <AddCardForm />
          {items.length > 0 ? (
            <PipelineBoard items={items} />
          ) : (
            <p className="text-muted-foreground text-sm">
              No cards yet. Add an idea to start moving it down the pipeline.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
