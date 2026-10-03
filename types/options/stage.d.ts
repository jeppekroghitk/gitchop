/**
 * The settings page imports `./stage.js`, which only a package has: it is src/content/chop.js,
 * bundled by dev/bundle.mjs. tsconfig.json lays this directory over src/options (rootDirs), so the
 * import resolves here, and the stage keeps the types of the module it is made from.
 */
export { createStage } from '../../src/content/chop.js';
