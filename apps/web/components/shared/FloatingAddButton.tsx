"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n/client";
import {
  useIsInlineQuickAddPresent,
  useQuickAddStore,
} from "@/lib/store/useQuickAddStore";
import { Link2, ListPlus, Plus, StickyNote, Upload, X } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";

import { useUploadAsset } from "../dashboard/UploadDropzone";

interface SpeedDialItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

function SpeedDialButton({
  item,
  index,
}: {
  item: SpeedDialItem;
  index: number;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={item.onSelect}
          aria-label={item.label}
          style={{ transitionDelay: `${index * 25}ms` }}
          className="flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-md ring-1 ring-border transition-transform hover:scale-105 hover:bg-accent active:scale-95"
        >
          {item.icon}
        </button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side="left">{item.label}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

export default function FloatingAddButton() {
  const { t } = useTranslation();
  const openDialog = useQuickAddStore((s) => s.openDialog);
  const inlinePresent = useIsInlineQuickAddPresent();
  const uploadAsset = useUploadAsset();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);

  // Global ⌘E: on pages that already show the inline "New Item" card, that
  // card handles ⌘E itself (focuses its own textarea) - opening the dialog
  // on top of it too would be redundant. Only step in when there's no
  // inline editor on the current page. Always opens the smart "auto" mode,
  // matching the inline card's own behavior.
  useHotkeys(
    "mod+e",
    () => {
      if (!inlinePresent) {
        openDialog("auto");
      }
    },
    [inlinePresent, openDialog],
  );

  // Collapse the speed-dial on Escape, regardless of which element has
  // focus (the buttons themselves already close on click).
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  // Each selection also collapses the speed-dial, so callers don't need to
  // remember to do it themselves.
  const withCollapse = (action: () => void) => () => {
    action();
    setExpanded(false);
  };

  const items: SpeedDialItem[] = [
    {
      key: "link",
      label: t("editor.add_link"),
      icon: <Link2 className="size-5" />,
      onSelect: withCollapse(() => openDialog("link")),
    },
    {
      key: "note",
      label: t("editor.add_note"),
      icon: <StickyNote className="size-5" />,
      onSelect: withCollapse(() => openDialog("note")),
    },
    {
      key: "multi-link",
      label: t("editor.add_multiple_links"),
      icon: <ListPlus className="size-5" />,
      onSelect: withCollapse(() => openDialog("multi-link")),
    },
    {
      key: "upload",
      label: t("editor.upload_file"),
      icon: <Upload className="size-5" />,
      onSelect: withCollapse(() => fileInputRef.current?.click()),
    },
  ];

  return (
    <>
      {expanded && (
        // Click-outside-to-close backdrop. A <button> (not a styled <div>)
        // so it's natively focusable/keyboard-operable without extra
        // role/key-handler wiring. Sits below the speed-dial buttons/main
        // button but above the rest of the page.
        <button
          type="button"
          aria-label={t("actions.close")}
          className="fixed inset-0 z-40 cursor-default"
          onClick={() => setExpanded(false)}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.md"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          files.forEach((file) => uploadAsset(file));
          // Allow selecting the same file again later.
          e.target.value = "";
        }}
      />
      <div className="fixed bottom-6 right-6 z-50 flex flex-col-reverse items-center gap-3">
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={t("editor.new_item")}
              aria-expanded={expanded}
              className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 active:scale-95"
            >
              {expanded ? (
                <X className="size-6" />
              ) : (
                <Plus className="size-6" />
              )}
            </button>
          </TooltipTrigger>
          {!expanded && (
            <TooltipPortal>
              <TooltipContent side="left">
                {t("editor.new_item")}
              </TooltipContent>
            </TooltipPortal>
          )}
        </Tooltip>
        {expanded &&
          items.map((item, idx) => (
            <SpeedDialButton key={item.key} item={item} index={idx} />
          ))}
      </div>
    </>
  );
}
