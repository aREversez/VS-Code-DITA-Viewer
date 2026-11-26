// Most core tests import modules from ../src directly instead of through the
// package entry point, which is what installs the Node platform as the default
// runtime. Do the same here, so those tests keep running on Node's fs and path.
import { nodePlatform } from '../src/node/nodePlatform';
import { createRuntime, setDefaultRuntime } from '../src/runtime';

setDefaultRuntime(createRuntime(nodePlatform));
