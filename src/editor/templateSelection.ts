/**
 * Which template a map is shown with, per document and per view. Stored
 * (globalState, see perDocumentState.ts) as { site?: id, book?: id }; an
 * absent key means "no template" -- the default look -- so the choice is
 * only ever stored when it differs from that.
 */
import type { SiteTemplate } from './siteTemplates';

export type TemplateMode = 'site' | 'book';
export type TemplateSelection = Partial<Record<TemplateMode, string>>;

export const TEMPLATE_SELECTION_KEY = 'ditaViewer.templateSelectionByUri';

export function parseTemplateSelection(raw: unknown): TemplateSelection {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: TemplateSelection = {};
  for (const mode of ['site', 'book'] as const) {
    const v = o[mode];
    if (typeof v === 'string' && v !== '') out[mode] = v;
  }
  return out;
}

/** `id` '' clears the choice for that mode. Does not mutate `prev`. */
export function withTemplate(prev: TemplateSelection, mode: TemplateMode, id: string): TemplateSelection {
  const next: TemplateSelection = { ...prev };
  if (id === '') delete next[mode];
  else next[mode] = id;
  return next;
}

/** The chosen template, or undefined when none is chosen or the chosen one no longer exists. */
export function pickTemplate(sel: TemplateSelection, mode: 'tree' | 'site' | 'book', templates: readonly SiteTemplate[]): SiteTemplate | undefined {
  if (mode === 'tree') return undefined;
  const id = sel[mode];
  return id === undefined ? undefined : templates.find((t) => t.id === id);
}
