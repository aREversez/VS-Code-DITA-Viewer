// An engine: core bound to one Platform, with its own state (DESIGN.md 3.3, 3.4).
//
//   const engine = createEngine({ fs: createMemoryFileSystem(files), path: posixPath });
//   engine.renderTopicXml({ ... });
//
// Each method is the existing function of the same name, run with this engine's
// runtime active. Two engines never share overlays, caches, read roots or
// counters, and neither touches the default runtime the Node entry installs.

import * as api from './api';
import { RUNTIME_DEPENDENT, type RuntimeDependentName } from './exportKinds';
import type { Platform } from './platform';
import { createRuntime, withRuntime } from './runtime';

export type EngineFunctions = { [K in RuntimeDependentName]: (typeof api)[K] };

export interface Engine extends EngineFunctions {
  readonly platform: Platform;
}

export function createEngine(platform: Platform): Engine {
  const runtime = createRuntime(platform);
  const engine: Record<string, unknown> = { platform };
  for (const name of RUNTIME_DEPENDENT) {
    const fn = api[name] as (...args: unknown[]) => unknown;
    engine[name] = (...args: unknown[]) => withRuntime(runtime, () => fn(...args));
  }
  return engine as unknown as Engine;
}
