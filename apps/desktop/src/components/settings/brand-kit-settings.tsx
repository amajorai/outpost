/**
 * Brand Kit editor (U13).
 *
 * Edits the workspace's logos, colors, fonts, and watermark. Logos and the
 * watermark image are references to local files (picked via the native dialog);
 * colors and fonts are simple named entries. Changes are local until "Save",
 * which upserts the per-workspace brand_kit row. The watermark logo is chosen
 * from the kit's logos so the overlay always resolves to a real file.
 */

import { Button } from "@repo/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Palette, Plus, Sparkles, Trash2, Type } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { logger } from "@/lib/logger";
import type {
  BrandColor,
  BrandFont,
  BrandLogo,
  BrandWatermark,
  WatermarkPosition,
} from "@/lib/social-schema";
import { useBrandKitStore } from "@/stores/use-brand-kit-store";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"];
const PATH_SEPARATOR = /[/\\]/;

const WATERMARK_POSITIONS: readonly {
  value: WatermarkPosition;
  label: string;
}[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "center", label: "Center" },
];

function fileName(path: string): string {
  const parts = path.split(PATH_SEPARATOR);
  return parts.at(-1) ?? path;
}

export function BrandKitSettings() {
  const kit = useBrandKitStore((s) => s.kit);
  const isSaving = useBrandKitStore((s) => s.isSaving);
  const error = useBrandKitStore((s) => s.error);
  const load = useBrandKitStore((s) => s.load);
  const save = useBrandKitStore((s) => s.save);

  const [logos, setLogos] = useState<BrandLogo[]>([]);
  const [colors, setColors] = useState<BrandColor[]>([]);
  const [fonts, setFonts] = useState<BrandFont[]>([]);
  const [watermark, setWatermark] = useState<BrandWatermark | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  // Sync local edit state when the loaded/saved kit changes.
  useEffect(() => {
    setLogos(kit.logos);
    setColors(kit.colors);
    setFonts(kit.fonts);
    setWatermark(kit.watermark);
  }, [kit]);

  const handleAddLogo = useCallback(async () => {
    try {
      const selection = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "Image", extensions: IMAGE_EXTENSIONS }],
      });
      if (!selection) {
        return;
      }
      const paths = Array.isArray(selection) ? selection : [selection];
      const added: BrandLogo[] = paths.map((path) => ({
        path,
        name: fileName(path),
      }));
      setLogos((prev) => {
        const existing = new Set(prev.map((logo) => logo.path));
        return [...prev, ...added.filter((logo) => !existing.has(logo.path))];
      });
    } catch (err) {
      logger.error({ err }, "[BrandKit] Failed to pick logo");
    }
  }, []);

  const handleRemoveLogo = useCallback((path: string) => {
    setLogos((prev) => prev.filter((logo) => logo.path !== path));
    setWatermark((prev) => (prev?.path === path ? null : prev));
  }, []);

  const handleSetWatermarkLogo = useCallback((path: string) => {
    if (path === "") {
      setWatermark(null);
      return;
    }
    setWatermark((prev) => ({
      path,
      position: prev?.position ?? "bottom-right",
      opacity: prev?.opacity ?? 0.8,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setSavedNotice(null);
    try {
      await save({ logos, colors, fonts, watermark });
      setSavedNotice("Brand kit saved");
    } catch {
      // error surfaced by the store
    }
  }, [save, logos, colors, fonts, watermark]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" strokeWidth={1.5} />
          Brand kit
        </CardTitle>
        <CardDescription>
          Your logos, colors, fonts, and watermark. Apply the watermark per
          platform when composing.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Logos */}
        <div className="flex flex-col gap-3">
          <Label>Logos</Label>
          {logos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {logos.map((logo) => (
                <div
                  className="group relative size-16 overflow-hidden rounded-xl border bg-muted"
                  key={logo.path}
                >
                  {/* biome-ignore lint/performance/noImgElement: Tauri webview, no next/image; local asset preview */}
                  {/* biome-ignore lint/correctness/useImageSize: thumbnail is CSS-sized via object-contain */}
                  <img
                    alt={logo.name}
                    className="size-full object-contain p-1"
                    src={convertFileSrc(logo.path)}
                  />
                  <button
                    aria-label={`Remove ${logo.name}`}
                    className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => handleRemoveLogo(logo.path)}
                    type="button"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button
            className="w-fit"
            onClick={handleAddLogo}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
            Add logo
          </Button>
        </div>

        {/* Colors */}
        <div className="flex flex-col gap-3">
          <Label className="flex items-center gap-2">
            <Palette className="size-4" strokeWidth={1.5} />
            Colors
          </Label>
          <div className="flex flex-col gap-2">
            {colors.map((color, index) => (
              <div
                className="flex items-center gap-2"
                // biome-ignore lint/suspicious/noArrayIndexKey: editable ordered list keyed by position
                key={index}
              >
                <input
                  aria-label={`Color ${index + 1} value`}
                  className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent"
                  onChange={(e) =>
                    setColors((prev) =>
                      prev.map((c, i) =>
                        i === index ? { ...c, value: e.target.value } : c
                      )
                    )
                  }
                  type="color"
                  value={color.value || "#000000"}
                />
                <Input
                  aria-label={`Color ${index + 1} name`}
                  onChange={(e) =>
                    setColors((prev) =>
                      prev.map((c, i) =>
                        i === index ? { ...c, name: e.target.value } : c
                      )
                    )
                  }
                  placeholder="Name (e.g. Primary)"
                  value={color.name}
                />
                <Button
                  aria-label={`Remove color ${index + 1}`}
                  onClick={() =>
                    setColors((prev) => prev.filter((_, i) => i !== index))
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            className="w-fit"
            onClick={() =>
              setColors((prev) => [...prev, { name: "", value: "#000000" }])
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
            Add color
          </Button>
        </div>

        {/* Fonts */}
        <div className="flex flex-col gap-3">
          <Label className="flex items-center gap-2">
            <Type className="size-4" strokeWidth={1.5} />
            Fonts
          </Label>
          <div className="flex flex-col gap-2">
            {fonts.map((font, index) => (
              <div
                className="flex items-center gap-2"
                // biome-ignore lint/suspicious/noArrayIndexKey: editable ordered list keyed by position
                key={index}
              >
                <Input
                  aria-label={`Font ${index + 1} name`}
                  onChange={(e) =>
                    setFonts((prev) =>
                      prev.map((f, i) =>
                        i === index ? { ...f, name: e.target.value } : f
                      )
                    )
                  }
                  placeholder="Label (e.g. Heading)"
                  value={font.name}
                />
                <Input
                  aria-label={`Font ${index + 1} family`}
                  onChange={(e) =>
                    setFonts((prev) =>
                      prev.map((f, i) =>
                        i === index ? { ...f, family: e.target.value } : f
                      )
                    )
                  }
                  placeholder="Font family (e.g. Inter)"
                  value={font.family}
                />
                <Button
                  aria-label={`Remove font ${index + 1}`}
                  onClick={() =>
                    setFonts((prev) => prev.filter((_, i) => i !== index))
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            className="w-fit"
            onClick={() =>
              setFonts((prev) => [...prev, { name: "", family: "" }])
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
            Add font
          </Button>
        </div>

        {/* Watermark */}
        <div className="flex flex-col gap-3">
          <Label htmlFor="watermark-logo">Watermark</Label>
          <p className="text-muted-foreground text-sm">
            Pick a logo to overlay on post previews. You choose which platforms
            it applies to when composing.
          </p>
          <NativeSelect
            id="watermark-logo"
            onChange={(e) => handleSetWatermarkLogo(e.target.value)}
            value={watermark?.path ?? ""}
          >
            <NativeSelectOption value="">No watermark</NativeSelectOption>
            {logos.map((logo) => (
              <NativeSelectOption key={logo.path} value={logo.path}>
                {logo.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          {watermark && (
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="watermark-position">Position</Label>
                <NativeSelect
                  id="watermark-position"
                  onChange={(e) =>
                    setWatermark((prev) =>
                      prev
                        ? {
                            ...prev,
                            position: e.target.value as WatermarkPosition,
                          }
                        : prev
                    )
                  }
                  value={watermark.position}
                >
                  {WATERMARK_POSITIONS.map((pos) => (
                    <NativeSelectOption key={pos.value} value={pos.value}>
                      {pos.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="watermark-opacity">
                  Opacity ({Math.round(watermark.opacity * 100)}%)
                </Label>
                <input
                  className="w-full"
                  id="watermark-opacity"
                  max={1}
                  min={0}
                  onChange={(e) =>
                    setWatermark((prev) =>
                      prev ? { ...prev, opacity: Number(e.target.value) } : prev
                    )
                  }
                  step={0.05}
                  type="range"
                  value={watermark.opacity}
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {savedNotice && !error && (
          <p className="text-emerald-600 text-sm dark:text-emerald-400">
            {savedNotice}
          </p>
        )}

        <Button
          className="w-fit"
          disabled={isSaving}
          onClick={handleSave}
          type="button"
        >
          Save brand kit
        </Button>
      </CardContent>
    </Card>
  );
}
