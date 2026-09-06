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

  it('keeps the visor on the eye at every blend', () => {
    // The visor used to cross-fade onto a hull-framed halo as the camera fell
    // back. Chase is the default view and the hull sits nine units off the eye,
    // so that halo rendered every readout too small to read — which is the only
    // job the visor has. It is worn at both ends now.
    for (const blend of [ 0, 0.25, 0.5, 0.75, 1 ]) {
      const station = hudStation(createHudStation(), input(blend))
      expect(station.position.toArray(), `blend ${blend}`).toEqual([ 0, 3.4, -9 ])
    }
  })

  it('holds the panels at one distance from the eye whatever the camera does', () => {
    const eye       = new THREE.Vector3(0, 3.4, -9)
    const distances = [ 0, 0.5, 1 ].map(blend => facetCentre(blend).distanceTo(eye))
    for (const distance of distances)
      expect(distance).toBeCloseTo(distances[0], 6)
  })

  it('ignores the hull pose entirely', () => {
    // The halo orbited the hull. A worn visor cannot: it faces wherever the
    // CAMERA station does, so a hard turn — which swings the hull long before
    // the damped chase camera follows it — must not move the instruments.
    const level = input(0)
    const rolled = {
      ...level,
      hullQuaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      shipPosition:   new THREE.Vector3(120, -40, 260),
    }

    const a = hudStation(createHudStation(), level)
    const b = hudStation(createHudStation(), rolled)

    expect(b.position.toArray()).toEqual(a.position.toArray())
    expect(b.quaternion.toArray()).toEqual(a.quaternion.toArray())
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

  it('leaves the visor centred on frames at least as wide as it was authored for', () => {
    for (const aspect of [ 16 / 9, 21 / 9, 4 / 3 ]) {
      const station = hudStation(createHudStation(), input(1, 0, aspect))
      expect(station.position.toArray(), `aspect ${aspect}`).toEqual([ 0, 3.4, -9 ])
    }
  })
})
