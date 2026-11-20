/**
 * How big is this STL, in its own units?
 *
 * The parse itself lives in `src/shared/stl-measure.ts` so the web build can
 * measure a bundled part's model exactly the way the desktop does. This module
 * stays as the main process's import path: `robot/ipc.ts` measures a mesh on its
 * way into a project, and since #787 `parts/library.ts` measures one on its way
 * into a part folder. `parts/library.ts` is already imported BY `robot/ipc.ts`,
 * so measuring from there would close a cycle.
 */
export { stlMaxDim } from '../../shared/stl-measure'
