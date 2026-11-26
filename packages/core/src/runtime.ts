// The ambient runtime: which Platform (and, from step 4 on, which process-wide
// state) the code running right now belongs to. Internal: not exported from
// any entry point. See DESIGN.md, section 3.4.
//
// Threading a platform argument through every function would touch nearly every
// file and call site. Instead the engine runs each call inside `withRuntime`,
// and the two thin modules that replace the Node imports (runtime/path.ts,
// runtime/fs.ts) look the platform up with `rt()`.

import type { Platform } from './platform';

/** Everything that used to be a module-level variable. Filled in as it moves (DESIGN.md 3.6, step 4). */
export type RuntimeState = Record<string, never>;

export interface Runtime {
  readonly platform: Platform;
  readonly state: RuntimeState;
}

export function createRuntime(platform: Platform): Runtime {
  return { platform, state: {} };
}

let current: Runtime | undefined;
let fallback: Runtime | undefined;

/** The entry point that targets Node installs `nodePlatform` here when it loads. Portable entries install nothing. */
export function setDefaultRuntime(runtime: Runtime | undefined): void {
  fallback = runtime;
}

export function getDefaultRuntime(): Runtime | undefined {
  return fallback;
}

/**
 * Runs `fn` with `runtime` active and restores the previous one afterwards, so
 * calls nest (a host callback such as asWebviewUri may re-enter another engine).
 *
 * INVARIANT: this is safe only because the whole pipeline is synchronous, so
 * two calls can never interleave. Any future async API must thread the runtime
 * explicitly instead of relying on `current`.
 */
export function withRuntime<T>(runtime: Runtime, fn: () => T): T {
  const previous = current;
  current = runtime;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** The active runtime, else the default one; throws when neither exists. */
export function rt(): Runtime {
  const r = current ?? fallback;
  if (!r) throw new Error('no platform: call this through an engine (createEngine), or import the Node entry point');
  return r;
}
