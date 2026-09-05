import type * as THREE from 'three'


/** Remove immutable world transforms from three's per-frame matrix walk. */
export function freezeStaticTree (root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  root.traverse(object => {
    object.updateMatrix()
    object.matrixAutoUpdate = false
  })
}
