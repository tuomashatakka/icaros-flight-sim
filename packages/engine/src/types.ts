import type { App } from 'threejs-scene'

/**
 * Any mounted scene. Mount functions are generic over their own state shape,
 * so the handle React and the WebGL report hold is deliberately erased.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
export type AnyApp = App<any>
