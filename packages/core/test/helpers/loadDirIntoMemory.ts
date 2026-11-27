import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { createMemoryFileSystem, type MemoryFileSystem } from '../../src/memoryFileSystem';

const TEXT = /\.(dita|ditamap|xml|ditaval|css|svg|txt|md|html?)$/i;

/** Every file under `dir`, loaded under its own absolute path, so rendered output (which embeds paths) can be compared byte for byte with a run on the real disk. */
export function loadDirIntoMemory(dir: string): { fs: MemoryFileSystem; files: string[] } {
  const entries: Record<string, string | Uint8Array> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else entries[full] = TEXT.test(e.name) ? readFileSync(full, 'utf-8') : new Uint8Array(readFileSync(full));
    }
  };
  walk(dir);
  return { fs: createMemoryFileSystem(entries), files: Object.keys(entries).sort() };
}
