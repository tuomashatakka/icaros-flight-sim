import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { createGeneratedIcarasShip } from '@/lib/ship/icaras-generated'
import { buildImportedShipObject, blankTexManager } from '@/lib/ship/fbx-ship'
import { SHIP_PRESETS, applyShipConfig, getFitTransform } from '@/lib/ship/materials'
import type { ShipConfig } from '@/lib/ship/materials'
import type { ShipId } from '@/lib/ship/registry'
import { createAfterburner, deriveNozzles } from '../fx/afterburner'
import type { Afterburner } from '../fx/afterburner'

// `blankTexManager` rewrites every image URL the FBX asks for to a 1x1 GIF —
// the WipEout scans carry baked absolute Windows paths that would otherwise 404.
// Passing it to the constructor is cleaner than mutating `.manager` after.
const fbxLoader  = new FBXLoader(blankTexManager)
const gltfLoader = new GLTFLoader()

/**
 * L1 cache: parsed source assets, keyed by path.
 *
 * These are never added to a scene and never disposed — instances clone from
 * them. Because `disposeScene` frees every material it walks, a template that
 * ever entered the graph would be freed out from under the cache and the *next*
 * load would render an invisible ship.
 */
const templates = new Map<string, Promise<THREE.Object3D>>()

function loadFbxTemplate (path: string): Promise<THREE.Object3D> {
  let pending = templates.get(path)
  if (!pending) {
    pending = fbxLoader.loadAsync(path)
    templates.set(path, pending)
  }
  return pending
}

function loadGltfTemplate (path: string): Promise<THREE.Object3D> {
  let pending = templates.get(path)
  if (!pending) {
    pending = gltfLoader.loadAsync(path).then(gltf => gltf.scene)
    templates.set(path, pending)
  }
  return pending
}

/** Deep clone including per-texture clones, so an instance owns everything it touches. */
function cloneGltfObject (object: THREE.Object3D): THREE.Object3D {
  const clone = object.clone(true)
  clone.traverse(child => {
    if ('isMesh' in child && (child as THREE.Mesh).isMesh) {
      const mesh         = child as THREE.Mesh
      mesh.castShadow    = true
      mesh.receiveShadow = true
      mesh.geometry      = mesh.geometry.clone()
      mesh.material      = Array.isArray(mesh.material)
        ? mesh.material.map(cloneMaterialWithTextures)
        : cloneMaterialWithTextures(mesh.material)
    }
  })
  return clone
}

function cloneMaterialWithTextures<T extends THREE.Material> (material: T): T {
  const clone = material.clone() as T
  const slots = clone as unknown as Record<string, unknown>
  for (const [ key, value ] of Object.entries(slots))
    if (value instanceof THREE.Texture) {
      const texture                       = value.clone()
      texture.userData.shipManagedTexture = true
      slots[key]                          = texture
    }
  return clone
}

export type ShipInstance = {

  /** Write the sim pose to THIS. Scale lives on an inner group. */
  root: THREE.Group;

  /**
   * Engine plume. Parented to `root`, so its nozzle coordinates are already in
   * fitted units and it inherits the hull's pose for free. Callers own the
   * throttle: `setThrottle` + `update` each rendered frame.
   */
  burner: Afterburner;

  /** Re-apply livery without rebuilding — palette/colour/roughness edits. */
  applyConfig(config: ShipConfig): void;
  dispose(): void;
}

/**
 * Load a ship and fit it for the game.
 *
 * Replaces the Suspense-throwing `useGLTF`/`useLoader` path with explicit async,
 * so a caller can show a real loading state instead of a blank canvas.
 *
 * The returned hierarchy is `root -> fit(scale) -> model`, deliberately: the sim
 * writes `root.position`/`root.quaternion` every frame, so a scale set there
 * would be clobbered.
 */
export async function loadShip (shipId: ShipId, targetSize: number): Promise<ShipInstance> {
  const preset = SHIP_PRESETS[shipId]

  let model: THREE.Object3D
  switch (preset.kind) {
    case 'gltf': {
      const template = await loadGltfTemplate(preset.path)
      model = cloneGltfObject(template)
      break
    }
    case 'fbx': {
      const template = await loadFbxTemplate(preset.path)
      // Each hull is one mesh with a 4-material array whose ORDER VARIES per
      // ship, remapped slot-by-slot inside here. Per-instance and order
      // dependent, so it can never be cached.
      model = buildImportedShipObject(template.clone(true), preset.textureBase)
      break
    }
    case 'generated':
      model = createGeneratedIcarasShip({})
      break
    default:
      throw new Error(`Unknown ship kind for "${shipId}"`)
  }

  // Shadow flags for EVERY kind. `cloneGltfObject` sets these on the gltf path,
  // but the FBX hulls and the generated Icaras come from elsewhere — without
  // this they silently cast no shadow, so the shadow appears and vanishes as
  // you switch ships.
  model.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh)
      return
    mesh.castShadow    = true
    mesh.receiveShadow = true
  })

  const fit = getFitTransform(model, targetSize)

  const inner = new THREE.Group()
  inner.scale.setScalar(fit.scale)
  if (preset.modelRotation)
    model.rotation.set(preset.modelRotation[0], preset.modelRotation[1], preset.modelRotation[2])

  // The recentring offset has to be rotated too. Three composes a local matrix
  // as T·R, so a vertex lands at R·v + t: to bring the measured centre `c` to
  // the origin, t must be -R·c, not -c. Feeding the unrotated centre left cb1 —
  // the one ship with a non-identity `modelRotation` — pivoting about a point
  // well off its own hull.
  const centre = new THREE.Vector3(fit.center[0], fit.center[1], fit.center[2])
  centre.applyEuler(model.rotation)
  model.position.copy(centre).negate()
  inner.add(model)

  const root = new THREE.Group()
  root.name  = `ship:${shipId}`
  root.add(inner)

  const burner = createAfterburner()
  root.add(burner.group)

  // Nozzles are derived from `inner` (post-fit, post-rotation) so they land in
  // root-local units and survive any future change to the fit maths.
  let nozzleSpread = -1

  return {
    root,
    burner,
    applyConfig (config) {
      applyShipConfig(model, config)
      // Re-deriving walks every vertex, so only redo it when the spread moved.
      if (config.nozzleSpread !== nozzleSpread) {
        nozzleSpread = config.nozzleSpread
        burner.setNozzles(deriveNozzles(inner, nozzleSpread))
      }
      burner.setColor(config.burnColor)
      burner.setTuning({
        burnIntensity: config.burnIntensity,
        burnLength:    config.burnLength,
      })
    },
    dispose () {
      burner.dispose()
      root.removeFromParent()
      // Free only what this instance owns. Templates stay cached, and their
      // textures were cloned per instance above.
      model.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh)
          return
        mesh.geometry?.dispose()

        const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
        for (const material of materials) {
          if (!material)
            continue

          const slots = material as unknown as Record<string, unknown>
          for (const value of Object.values(slots))
            if (value instanceof THREE.Texture && value.userData.shipManagedTexture)
              value.dispose()
          material.dispose()
        }
      })
    },
  }
}

/** Warm the L1 cache — call from a hover handler so the swap feels instant. */
export function preloadShip (shipId: ShipId): void {
  const preset = SHIP_PRESETS[shipId]
  if (preset.kind === 'fbx')
    void loadFbxTemplate(preset.path)
  else if (preset.kind === 'gltf')
    void loadGltfTemplate(preset.path)
}
