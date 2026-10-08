/**
 * Which template a map is shown with, per document and per view. Stored
 * (globalState, see perDocumentState.ts) as { site?, book? }, each one of:
 *   - a template id: that view's own choice;
 *   - null: that view's own choice is "default look" (no template);
 *   - absent: the view has not been chosen for, and follows the other view.
 *
 * Without the "follows" rule, switching a map from site to book -- the
 * views that share one template shell -- dropped back to the default look
 * the first time, which read as the choice being lost. Without the null, a
 * view could never choose the default look while the other view had a
 * template, because "absent" would hand it that template. A view that has
 * been chosen for keeps its own choice from then on.
 */
import type { SiteTemplate } from './siteTemplates';

export type TemplateMode = 'site' | 'book';
export type TemplateSelection = Partial<Record<TemplateMode, string | null>>;

export const TEMPLATE_SELECTION_KEY = 'ditaViewer.templateSelectionByUri';

export function parseTemplateSelection(raw: unknown): TemplateSelection {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: TemplateSelection = {};
  for (const mode of ['site', 'book'] as const) {
    const v = o[mode];
    if (v === null) out[mode] = null;
    else if (typeof v === 'string' && v !== '') out[mode] = v;
  }
  return out;
}

/** `id` '' chooses the default look for that mode (stored as null). Does not mutate `prev`. */
export function withTemplate(prev: TemplateSelection, mode: TemplateMode, id: string): TemplateSelection {
  return { ...prev, [mode]: id === '' ? null : id };
}

/**
 * The template a view is shown with: its own choice, else (when it has none)
 * the other view's, and undefined for the default look, for a template that
 * has gone, and in tree mode. A view's own choice that has gone does not
 * fall through to the other view.
 */
export function pickTemplate(sel: TemplateSelection, mode: 'tree' | 'site' | 'book', templates: readonly SiteTemplate[]): SiteTemplate | undefined {
  if (mode === 'tree') return undefined;
  const own = sel[mode];
  const id = own !== undefined ? own : sel[mode === 'site' ? 'book' : 'site'];
  return id == null ? undefined : templates.find((t) => t.id === id);
}
