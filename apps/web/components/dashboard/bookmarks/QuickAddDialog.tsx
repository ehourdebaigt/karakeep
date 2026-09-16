"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/client";
import { QuickAddMode, useQuickAddStore } from "@/lib/store/useQuickAddStore";

import { QuickAddForm } from "./QuickAddForm";

function useDialogCopy(mode: QuickAddMode) {
  const { t } = useTranslation();
  switch (mode) {
    case "link":
      return {
        title: t("editor.add_link"),
        description: t("editor.quick_add_link_description"),
      };
    case "note":
      return {
        title: t("editor.add_note"),
        description: t("editor.quick_add_note_description"),
      };
    case "multi-link":
      return {
        title: t("editor.add_multiple_links"),
        description: t("editor.quick_add_multi_link_description"),
      };
    case "auto":
    default:
      return {
        title: t("editor.new_item"),
        description: t("dashboard.quick_add_description"),
      };
  }
}

export default function QuickAddDialog() {
  const open = useQuickAddStore((s) => s.dialogOpen);
  const setOpen = useQuickAddStore((s) => s.setDialogOpen);
  const mode = useQuickAddStore((s) => s.dialogMode);
  const { title, description } = useDialogCopy(mode);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && (
          <QuickAddForm
            className="min-h-40"
            mode={mode}
            autoResize
            autoFocus
            onSuccess={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
