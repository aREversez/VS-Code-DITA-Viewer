// Entry point for Node: the Node platform, and an engine bound to it.

import { createEngine, type Engine } from '../engine';
import { nodePlatform } from './nodePlatform';

export { nodePlatform };

/** An engine over Node's fs and path, with state of its own (not the default runtime's). */
export function createNodeEngine(): Engine {
  return createEngine(nodePlatform);
}
