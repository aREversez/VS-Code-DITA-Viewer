/**
 * Where "open the source of this topic" should land, decided without any
 * vscode types so the rule is unit tested directly (the same split as
 * mapViewState.ts / pendingRender.ts).
 *
 * The point of the feature is that the reader never has to switch tabs
 * back and forth: the source opens in a tab group other than the one the
 * docsite preview sits in.
 */

export interface PlacementGroup<K> {
  /** Opaque identity of the tab group (the caller's own handle for it). */
  key: K;
  /** URIs (toString()) of the plain-text-editor tabs the group has open. */
  textUris: readonly string[];
}

export type SourcePlacement<K> = { kind: 'group'; key: K } | { kind: 'beside' };

/**
 * Picks the tab group to show `uri`'s source in.
 *
 * 1. A group other than the preview's that already has the source open --
 *    reuse it, so repeated requests do not pile up duplicate tabs.
 * 2. Otherwise the most recently active group that is not the preview's
 *    (`recentKeys` is most-recent-first; keys of groups that no longer exist
 *    are skipped).
 * 3. Otherwise any other group, in the order given.
 * 4. Otherwise (the preview is alone) a new group beside it.
 */
export function chooseSourcePlacement<K>(
  groups: readonly PlacementGroup<K>[],
  previewKey: K | undefined,
  recentKeys: readonly K[],
  uri: string,
): SourcePlacement<K> {
  const others = groups.filter((g) => g.key !== previewKey);
  if (others.length === 0) return { kind: 'beside' };

  const holder = others.find((g) => g.textUris.includes(uri));
  if (holder) return { kind: 'group', key: holder.key };

  for (const key of recentKeys) {
    const match = others.find((g) => g.key === key);
    if (match) return { kind: 'group', key: match.key };
  }
  return { kind: 'group', key: others[0].key };
}

/** Moves `key` to the front of a most-recent-first list, without mutating it. */
export function touchRecent<K>(recent: readonly K[], key: K): K[] {
  return [key, ...recent.filter((k) => k !== key)];
}
