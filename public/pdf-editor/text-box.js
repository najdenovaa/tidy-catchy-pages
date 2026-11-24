export const pointsPerMillimeter = 72 / 25.4;
export function resizeTextBox(draft, width, page) {
  if (!Number.isFinite(width)) return;
  draft.width = Math.max(Math.min(24, page.pageWidth - draft.x - 3), Math.min(width, page.pageWidth - draft.x - 3));
  draft.dirty = true;
}
export function moveTextBox(draft, x, y, page, height = Math.max(draft.size, draft.lineHeight)) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const left = Math.max(3, Math.min(x, page.pageWidth - draft.width - 3));
  const top = Math.max(3, Math.min(y, page.pageHeight - height - 3));
  const dy = top - draft.y;
  draft.x = left;
  draft.y = top;
  draft.baseline += dy;
  // Keep the old scan's erasure rectangle fixed; only the replacement text moves.
  draft.dirty = true;
}
