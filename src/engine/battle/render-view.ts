import * as THREE from 'three'


export type RenderKind = 'remote' | 'objective' | 'zone' | 'projectile' | 'explosion' | 'scenery'
export type UpdateTier = 'full' | 'reduced' | 'transform' | 'hidden'

export type RenderSample = {
  distance:        number;
  projectedPixels: number;
  inFrustum:       boolean;
  importance:      number;
  tier:            UpdateTier;
  update:          boolean;
}

export type RenderSubject = {
  position: THREE.Vector3Like;
  radius:   number;
  kind:     RenderKind;
  target?:  boolean;
}

export const BATTLE_EFFECT_BUDGETS = {
  high:   { beams: 48, missiles: 64, explosions: 24 },
  medium: { beams: 32, missiles: 40, explosions: 16 },
  low:    { beams: 20, missiles: 24, explosions: 10 },
} as const

export type BattleQuality = keyof typeof BATTLE_EFFECT_BUDGETS

const HIDDEN_PIXELS    = 1.5
const TRANSFORM_PIXELS = 9
const FULL_DISTANCE    = 120
const REDUCED_EVERY    = 4

const KIND_WEIGHT: Record<RenderKind, number> = {
  remote:     90,
  objective:  75,
  zone:       60,
  projectile: 85,
  explosion:  70,
  scenery:    15,
}

/**
 * One camera classification pass shared by every battle visual.
 *
 * The frustum and projection scale are rebuilt once in `beginFrame`; callers
 * only provide a centre and conservative bounding radius. This deliberately
 * does not manufacture `THREE.LOD` nodes. LOD is reserved for assets with real
 * alternate geometry, while these lightweight effects are cheaper to skip or
 * tick less often than to wrap in another scene-graph level.
 */
export class BattleRenderView {
  private readonly frustum = new THREE.Frustum()
  private readonly matrix = new THREE.Matrix4()
  private readonly camera = new THREE.Vector3()
  private readonly sphere = new THREE.Sphere()
  private frame = 0
  private pixelsPerUnit = 1

  beginFrame (camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    camera.updateMatrixWorld()
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.matrix)
    this.camera.setFromMatrixPosition(camera.matrixWorld)
    this.pixelsPerUnit = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    this.frame++
  }

  sample ({ position, radius, kind, target = false }: RenderSubject): RenderSample {
    const dx       = position.x - this.camera.x
    const dy       = position.y - this.camera.y
    const dz       = position.z - this.camera.z
    const distance = Math.max(0.001, Math.hypot(dx, dy, dz))
    const pixels   = radius * this.pixelsPerUnit / distance
    const visible  = pixels >= HIDDEN_PIXELS &&
      this.frustum.intersectsSphere(this.sphere.set(
        this.sphere.center.set(position.x, position.y, position.z), radius
      ))

    let tier: UpdateTier
    if (!visible)
      tier = 'hidden'
    else if (target || distance <= FULL_DISTANCE)
      tier = 'full'
    else if (kind === 'remote' && pixels < TRANSFORM_PIXELS)
      tier = 'transform'
    else
      tier = 'reduced'

    const importance = (target ? 1_000 : 0) + KIND_WEIGHT[kind] + pixels * 2 - distance * 0.025
    return {
      distance,
      projectedPixels: pixels,
      inFrustum:       visible,
      importance,
      tier,
      update:          tier === 'full' || tier === 'transform' || tier === 'reduced' && this.frame % REDUCED_EVERY === 0,
    }
  }
}

/** Keep a hard budget, preferring objects that matter on this frame. */
export function withinBudget<T> (values: readonly T[], limit: number, importance: (value: T) => number): T[] {
  if (values.length <= limit)
    return [ ...values ]
  return [ ...values ].sort((a, b) => importance(b) - importance(a)).slice(0, limit)
}
