/**
 * What the map preview remembers about a ditamap between openings: which of
 * its three views was showing and, for the docsite view, which topic. Kept in
 * globalState per document (MAP_VIEW_STATE_KEY, see perDocumentState.ts), the
 * same way the page width is.
 *
 * Pure of the vscode module so the two decisions worth pinning down -- what
 * a stored value is trusted to mean, and when a render is worth a write --
 * can be unit-tested. The wiring is in MapViewerProvider.
 */
export type MapMode = 'tree' | 'book' | 'site';

export interface MapViewState {
  mode: MapMode;
  /** Absolute path of the topic docsite view last showed. Kept while another mode is active. */
  sitePage?: string;
}

export const MAP_VIEW_STATE_KEY = 'ditaViewer.mapViewStateByUri';

const MODES: ReadonlySet<string> = new Set<MapMode>(['tree', 'book', 'site']);

/**
 * globalState survives extension upgrades and can be hand-edited, so a stored
 * value is only trusted as far as it checks out. An unknown mode reads as the
 * outline tree (the view a map opens in without any memory); a page that is
 * not a non-empty string is dropped. Whether the page still exists is not
 * this function's business: the docsite renderer already falls back to the
 * first topic for a page its manifest no longer has.
 */
export function parseMapViewState(raw: unknown): MapViewState | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { mode, sitePage } = raw as { mode?: unknown; sitePage?: unknown };
  const state: MapViewState = { mode: typeof mode === 'string' && MODES.has(mode) ? (mode as MapMode) : 'tree' };
  if (typeof sitePage === 'string' && sitePage !== '') state.sitePage = sitePage;
  return state;
}

/**
 * The value to store after a successful render, or undefined when what is
 * stored already says the same thing -- a full site-mode render happens on
 * every source edit, and none of those should touch globalState. A render
 * that did not resolve a site page (book and outline modes) leaves the
 * remembered one alone, so leaving site view and coming back to it lands on
 * the same topic.
 */
export function nextMapViewState(
  previous: MapViewState | undefined,
  mode: MapMode,
  sitePage: string | undefined,
): MapViewState | undefined {
  const page = sitePage ?? previous?.sitePage;
  if (previous === undefined && mode === 'tree' && page === undefined) return undefined;
  if (previous !== undefined && previous.mode === mode && previous.sitePage === page) return undefined;
  return page === undefined ? { mode } : { mode, sitePage: page };
}
