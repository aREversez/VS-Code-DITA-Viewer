// The +n −n ~n chip of the diff toolbar. Pure, so the counts a reader sees can
// be asserted without a webview.
export function renderStats(stats: { added: number; removed: number; modified: number }): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`<span class="stat-add">+${stats.added}</span>`);
  if (stats.removed > 0) parts.push(`<span class="stat-del">−${stats.removed}</span>`);
  if (stats.modified > 0) parts.push(`<span class="stat-mod">~${stats.modified}</span>`);
  return parts.join(' ') || '0';
}
