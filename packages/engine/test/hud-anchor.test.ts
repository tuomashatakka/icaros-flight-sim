import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createHudStation, hudStation } from 'Σhud/anchor'
import type { HudStationInput } from 'Σhud/anchor'


function input (cameraBlend: number, yaw = 0, aspect = 16 / 9): HudStationInput {
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 400)
  camera.position.set(0, 3.4, -9)

  const hullQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)

  return {
    cameraBlend,
    camera,
    // The cockpit anchor faces down the nose, like the chase camera does.
    hudQuaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI),
    hudLead:       new THREE.Quaternion(),
    shipPosition:  new THREE.Vector3(0, 0, 0),
    hullQuaternion,
  }
}

/** Where the visor's centre facet lands in world space, given a station. */
function facetCentre (cameraBlend: number, yaw = 0): THREE.Vector3 {
  const station = hudStation(createHudStation(), input(cameraBlend, yaw))
  // -6.35 is `HUD_VISOR_BOUNDS.centerDepth`: straight down the visor's own -Z.
  return new THREE.Vector3(0, 0, -6.35)
    .multiplyScalar(1)
    .applyQuaternion(station.quaternion)
    .add(station.position)
}

describe('hud anchor', () => {
  it('seats the visor on the camera at full cockpit blend', () => {
    const station = hudStation(createHudStation(), input(1))
    expect(station.position.toArray()).toEqual([ 0, 3.4, -9 ])
  })

  it('frames the visor on the hull at full chase blend', () => {
    const station = hudStation(createHudStation(), input(0))
    // The halo rides the ship, not the eye — this is the whole point of the
    // chase anchor, and it is what puts the panels around the hull.
    expect(station.position.x).toBe(0)
    expect(station.position.z).toBe(0)
    expect(station.position.y).toBeGreaterThan(0)
  })

  it('puts the chase panels further from the eye than the seated ones', () => {
    const eye  = new THREE.Vector3(0, 3.4, -9)
    const near = facetCentre(1).distanceTo(eye)
    const far  = facetCentre(0).distanceTo(eye)
    expect(far).toBeGreaterThan(near)
  })

  it('moves the anchor monotonically across the blend', () => {
    const eye       = new THREE.Vector3(0, 3.4, -9)
    const distances = [ 0, 0.25, 0.5, 0.75, 1 ].map(b => facetCentre(b).distanceTo(eye))
    for (let i = 1; i < distances.length; i++)
      expect(distances[i]).toBeLessThan(distances[i - 1])
  })

  it('orbits the halo with the hull yaw', () => {
    // The ship's forward is +Z, so the halo hangs off the nose and the camera
    // — 9 units behind the hull — sees the hull framed inside it.
    const ahead = facetCentre(0, 0)
    const right = facetCentre(0, Math.PI / 2)
    expect(ahead.z).toBeGreaterThan(1)
    expect(Math.abs(ahead.x)).toBeLessThan(1e-6)

    // A quarter turn swings the panels onto the ship's new forward axis.
    expect(right.x).toBeGreaterThan(1)
    expect(Math.abs(right.z)).toBeLessThan(1e-6)
  })

  it('never scales the visor to nothing', () => {
    for (const blend of [ 0, 0.5, 1 ]) {
      const station = hudStation(createHudStation(), input(blend))
      expect(station.scale.x).toBeGreaterThan(0.1)
      expect(station.scale.y).toBeGreaterThan(0.1)
    }
  })

  it('fits the visor to a portrait frame without distorting it', () => {
    // It used to scale X alone, which on a 19.5:9 phone squashed the visor to a
    // quarter of its width while leaving its height alone: every glyph became a
    // letterbox and the seven facets stopped reading as one folded surface.
    const portrait = hudStation(createHudStation(), input(1, 0, 390 / 844))

    expect(portrait.scale.x).toBeCloseTo(portrait.scale.y, 6)
    expect(portrait.scale.x).toBeLessThan(0.4)
  })

  it('drops the visor under the sightline in portrait and nowhere else', () => {
    // A cockpit keeps its instruments below the horizon, and in portrait there
    // are two thirds of a frame going spare above the thumb controls.
    const seated   = hudStation(createHudStation(), input(1)).position.clone()
    const portrait = hudStation(createHudStation(), input(1, 0, 390 / 844)).position.clone()

    // Landscape is untouched: the visor already fills the frame there.
    expect(seated.toArray()).toEqual([ 0, 3.4, -9 ])
    expect(portrait.y).toBeLessThan(seated.y)
  })

  it('wears the visor on a narrow frame even while the camera is in chase', () => {
    // A halo hung around the hull is unreadable on a phone held upright: the
    // seated station is screen-locked and fills the frame's width instead. The
    // camera has not moved — only the anchor.
    const chaseWide     = hudStation(createHudStation(), input(0))
    const chasePortrait = hudStation(createHudStation(), input(0, 0, 390 / 844))

    // Wide: the halo rides the ship at the origin, as it always has.
    expect(chaseWide.position.z).toBe(0)
    // Narrow: it has slid onto the camera.
    expect(chasePortrait.position.z).toBeCloseTo(-9, 6)
    expect(chasePortrait.position.y).toBeLessThan(3.4)
  })

  it('leaves the visor centred on frames at least as wide as it was authored for', () => {
    for (const aspect of [ 16 / 9, 21 / 9, 4 / 3 ]) {
      const station = hudStation(createHudStation(), input(1, 0, aspect))
      expect(station.position.toArray(), `aspect ${aspect}`).toEqual([ 0, 3.4, -9 ])
    }
  })
})
