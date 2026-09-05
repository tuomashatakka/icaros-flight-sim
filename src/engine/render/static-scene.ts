import * as THREE from 'three'


type InventoryRow = {
  draws:      number;
  geometries: Set<string>;
  instances:  number;
  material:   string;
  program:    string;
}

/** Finalise immutable rendering data after every transform and instance is set. */
export function freezeStatic (root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  root.traverse(object => {
    const renderable = object as THREE.Mesh | THREE.Line | THREE.Points
    if (renderable instanceof THREE.InstancedMesh) {
      renderable.computeBoundingBox()
      renderable.computeBoundingSphere()
    }
    if (renderable.geometry) {
      if (!renderable.geometry.boundingBox)
        renderable.geometry.computeBoundingBox()
      if (!renderable.geometry.boundingSphere)
        renderable.geometry.computeBoundingSphere()
    }
    object.updateMatrix()
    object.matrixAutoUpdate = false
  })
}

/** One concise, material/program-shaped inventory instead of a wall of meshes. */
export function reportDrawInventory (label: string, root: THREE.Object3D): void {
  if (process.env.NODE_ENV !== 'development')
    return

  const rows = new Map<string, InventoryRow>()
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.geometry || !mesh.material)
      return

    const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
    for (const material of materials) {
      const program = material.type
      const key     = `${program}:${material.uuid}`
      const row     = rows.get(key) ?? {
        draws:      0,
        geometries: new Set<string>(),
        instances:  0,
        material:   material.name || `${material.type}#${material.uuid.slice(0, 8)}`,
        program,
      }
      row.draws++
      row.geometries.add(mesh.geometry.type)
      row.instances += object instanceof THREE.InstancedMesh ? object.count : 1
      rows.set(key, row)
    }
  })

  console.table(Array.from(rows.values(), row => ({
    program:    row.program,
    material:   row.material,
    draws:      row.draws,
    instances:  row.instances,
    geometries: Array.from(row.geometries).join(', '),
  })))
  console.info(`[render inventory] ${label}: ${rows.size} materials`)
}

export function finaliseStaticScene (label: string, root: THREE.Object3D): void {
  freezeStatic(root)
  reportDrawInventory(label, root)
}
