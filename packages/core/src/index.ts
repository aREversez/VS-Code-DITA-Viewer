// Entry point of @dita-viewer/core for Node-compatible hosts.
//
// Everything is in api.ts; this file adds the one side effect, installing the
// Node platform as the default runtime, so every function below runs on Node's
// fs and path unless it is called through an engine (DESIGN.md 3.4). Hosts that
// are not Node use @dita-viewer/core/portable instead.

import { nodePlatform } from './node/nodePlatform';
import { createRuntime, setDefaultRuntime } from './runtime';

setDefaultRuntime(createRuntime(nodePlatform));

export * from './api';
export type { FileStat, FileSystem, PathOps, Platform } from './platform';
