/**
 * Saved-templates browser for the composer (U16).
 *
 * Lists the workspace's templates and applies one into the composer on click:
 * the template's body becomes the primary segment text and any per-platform
 * defaults seed the matching variants. This is the apply half of the templates
 * flow; creating/editing templates lives in the Templates section panel.
 */

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Wand2 } from "lucide-react";
import { useCallback, useState } from "react";
import {
  decodeTemplateBody,
  listTemplates as fetchTemplates,
} from "@/lib/repos/templates";
import type { Template } from "@/lib/social-schema";
import { useComposerStore } from "@/stores/use-composer-store";

function templateSummary(template: Template): string {
  const text = decodeTemplateBody(template.body).text.trim();
  if (text.length === 0) {
    return "Empty template";
  }
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

export function TemplatesDialog() {
  const applyTemplate = useComposerStore((s) => s.applyTemplate);
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setTemplates(await fetchTemplates());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        refresh();
      }
    },
    [refresh]
  );

  const handleSelect = useCallback(
    async (id: string) => {
      await applyTemplate(id);
      setOpen(false);
    },
    [applyTemplate]
  );

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <Button
        onClick={() => handleOpenChange(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Wand2 className="size-4" />
        Templates
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Templates</DialogTitle>
          <DialogDescription>
            Apply a saved template into your post.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {isLoading && (
            <p className="text-muted-foreground text-sm">Loading...</p>
          )}
          {!isLoading && templates.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No templates yet. Create one in the Templates section.
            </p>
          )}
          {templates.map((template) => (
            <button
              className="flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              key={template.id}
              onClick={() => handleSelect(template.id)}
              type="button"
            >
              <span className="font-medium">{template.name}</span>
              <span className="line-clamp-2 text-muted-foreground text-xs">
                {templateSummary(template)}
              </span>
            </button>
          ))}
        </div>
        <DialogClose
          render={
            <Button type="button" variant="ghost">
              Close
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
