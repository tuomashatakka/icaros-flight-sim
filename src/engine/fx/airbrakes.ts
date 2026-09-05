import * as THREE from 'three'

/**
 * Wing air brakes.
 *
 * Synthesised rather than authored, because no ship in the registry has one: the
 * Icaras foundry export is hull + two engine pods + two weapon pods, the seven
 * WipEout hulls are a single mesh each, and CB1's glTF clip is an unrelated
 * leftover rig the loader discards. The one place air brakes ever existed in
 * this project is the parametric Forge prototype that used to live at
 * `public/icaras/icaras-forge(1) copy.html` — deleted along with the rest of the
 * ugly primitives ship, recoverable from git. It tagged its wing meshes
 * `userData.flap = ±1` and eased `rotation.x` toward `-brake * 0.7`; that
 * convention is kept here deliberately, same tag and same curve, so the panels
 * read the way the prototype's did.
 *
 * Placement is measured off the loaded hull's bounding box, so a flap lands on
 * the wing of whatever ship is fitted instead of at a hardcoded offset that
 * only suits one of them.
 *
 * The deploy value driving these is the SAME `state.airbrake` the sim uses to
 * size the drag force, so the panel you see out the window is the panel that is
 * slowing you down.
 */
export type Airbrakes = {

  /** 0..1. Drives the hinge angle; the sim owns the easing. */
  setDeploy (value: number): void;
  dispose (): void;
}

const MAX_ANGLE = 0.7

export function createAirbrakes (hull: THREE.Object3D): Airbrakes {
  const bounds = new THREE.Box3().setFromObject(hull)
  const size   = bounds.getSize(new THREE.Vector3())
  const centre = bounds.getCenter(new THREE.Vector3())

  // A flap is a fraction of the hull, so it scales with whichever ship loaded.
  const span      = Math.max(size.x * 0.26, 0.18)
  const chord     = Math.max(size.z * 0.16, 0.14)
  const thickness = 0.035

  const geometry = new THREE.BoxGeometry(span, thickness, chord)
  // Shift the geometry back by half a chord so the group's origin sits on the
  // LEADING edge — the flap then hinges like a flap instead of pivoting through
  // its own middle and sinking half of itself into the wing.
  geometry.translate(0, 0, -chord / 2)

  const material = new THREE.MeshStandardMaterial({
    color:             '#2a3142',
    metalness:         0.65,
    roughness:         0.35,
    emissive:          '#22d3ee',
    emissiveIntensity: 0,
  })

  const panels: THREE.Object3D[] = []
  for (const side of [ -1, 1 ]) {
    const hinge = new THREE.Group()
    hinge.name  = side < 0 ? 'airbrake.L' : 'airbrake.R'
    hinge.position.set(
      centre.x + side * (size.x * 0.5 - span * 0.55),
      centre.y + size.y * 0.16,
      centre.z - size.z * 0.12
    )
    hinge.userData.flap = side

    const panel      = new THREE.Mesh(geometry, material)
    panel.castShadow = true
    // Every path that builds ship geometry has to set this, not just the glTF
    // one — a hull whose flaps do not cast is how the missing-shadow bug looked.
    panel.receiveShadow = true
    hinge.add(panel)
    hull.add(hinge)
    panels.push(hinge)
  }

  let deploy = 0

  return {
    setDeploy (value) {
      const next = Math.max(0, Math.min(1, value))
      if (Math.abs(next - deploy) < 1e-3)
        return
      deploy = next

      // Both flaps rise; `flap` only distinguishes them for the roll-linked
      // splay the Forge prototype layered on top of the brake angle.
      for (const hinge of panels)
        hinge.rotation.x = -deploy * MAX_ANGLE

      material.emissiveIntensity = deploy * 1.4
    },

    dispose () {
      for (const hinge of panels)
        hinge.removeFromParent()
      geometry.dispose()
      material.dispose()
      panels.length = 0
    },
  }
}
