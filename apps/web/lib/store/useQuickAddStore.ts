import { create } from "zustand";

// The floating button's speed-dial options that open the shared dialog.
// "auto" is the original smart-detect behavior (paste a link, write a note,
// or paste multiple URLs and get asked how to import them) - it's what ⌘E
// and the inline EditorCard use. The others pin the dialog to one explicit
// bookmark type instead of guessing from the input.
export type QuickAddMode = "auto" | "link" | "note" | "multi-link";

// Tracks whether a page-inline "New Item" editor card (EditorCard) is
// currently mounted, and owns the open state of the floating quick-add
// dialog that's available globally. Kept as a counter (not a boolean) so
// that briefly overlapping mounts (e.g. during route transitions) don't
// cause one unmount to incorrectly clear presence for the other.
interface QuickAddState {
  inlinePresentCount: number;
  registerInlinePresent: () => void;
  unregisterInlinePresent: () => void;
  dialogOpen: boolean;
  dialogMode: QuickAddMode;
  openDialog: (mode?: QuickAddMode) => void;
  closeDialog: () => void;
  setDialogOpen: (open: boolean) => void;
}

export const useQuickAddStore = create<QuickAddState>((set) => ({
  inlinePresentCount: 0,
  registerInlinePresent: () =>
    set((s) => ({ inlinePresentCount: s.inlinePresentCount + 1 })),
  unregisterInlinePresent: () =>
    set((s) => ({ inlinePresentCount: Math.max(0, s.inlinePresentCount - 1) })),
  dialogOpen: false,
  dialogMode: "auto",
  openDialog: (mode = "auto") => set({ dialogOpen: true, dialogMode: mode }),
  closeDialog: () => set({ dialogOpen: false }),
  setDialogOpen: (open) => set({ dialogOpen: open }),
}));

export function useIsInlineQuickAddPresent() {
  return useQuickAddStore((s) => s.inlinePresentCount > 0);
}
