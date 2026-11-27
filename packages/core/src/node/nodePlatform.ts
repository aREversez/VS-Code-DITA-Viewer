// The Node platform: `fs` and `path` behind the Platform interface. This
// directory is the only place in core that may import a Node built-in.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'fs';
import * as nodePath from 'path';
import type { FileStat, Platform } from '../platform';
import type { WalkEntry } from '../language/referenceableFiles';

export const nodePlatform: Platform = {
  fs: {
    readText: (path) => readFileSync(path, 'utf-8'),
    readHead(path, maxBytes) {
      const fd = openSync(path, 'r');
      try {
        const buf = new Uint8Array(maxBytes);
        const n = readSync(fd, buf, 0, maxBytes, 0);
        return buf.subarray(0, n);
      } finally {
        closeSync(fd);
      }
    },
    exists: (path) => existsSync(path),
    stat(path): FileStat | undefined {
      try {
        const st = statSync(path);
        return { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return undefined;
      }
    },
    readDir(path): WalkEntry[] {
      return readdirSync(path, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },
    realPath: (path) => realpathSync(path),
  },
  path: {
    sep: nodePath.sep,
    // Today's behaviour: only Windows lower-cases a path to use it as a key.
    caseSensitive: process.platform !== 'win32',
    resolve: nodePath.resolve,
    join: nodePath.join,
    dirname: nodePath.dirname,
    relative: nodePath.relative,
    isAbsolute: nodePath.isAbsolute,
    normalize: nodePath.normalize,
    extname: nodePath.extname,
  },
};
