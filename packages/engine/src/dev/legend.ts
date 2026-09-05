import * as THREE from 'three'
import type { OverlayFlags } from './types'

/**
 * The on-screen list of debug layers, and which key toggles each.
 *
 * Deliberately drawn by the dev harness onto its own canvas texture rather than
 * added to the spatial HUD. The HUD is production code and its action set is a
 * closed union; wiring dev-only overlay flags through it would put a dev concern
 * into a file that ships. This whole module is inside the `dev/` tree that the
 * production build drops, so the coupling stays one-directional.
 *
 * Parented to the camera, so it holds a screen corner without the render loop
 * having to place it every frame.
 */

const WIDTH  = 300
const HEIGHT = 360
const ROW    = 30

export type Legend = {
  layers: readonly (keyof OverlayFlags)[];
  render (active: OverlayFlags): void;
  setVisible (visible: boolean): void;
  dispose (): void;
}

/** Order is the key order: 1..9 map to these, 0 clears everything. */
const LAYERS: readonly (keyof OverlayFlags)[] = [
  'forces', 'netForce', 'thrusters', 'rays',
  'com', 'velocity', 'inertia', 'colliders', 'contacts',
]

/** Matches the arrow colours in `overlay.ts`, so the swatch means something. */
const SWATCH: Partial<Record<keyof OverlayFlags, string>> = {
  forces:    '#ff6b35',
  netForce:  '#ffffff',
  thrusters: '#06d6a0',
  rays:      '#00ff9c',
  com:       '#4cc9f0',
  velocity:  '#48cae4',
  inertia:   '#9d4edd',
  colliders: '#ffd166',
  contacts:  '#ff3366',
}

export function createLegend (camera: THREE.Camera, scene: THREE.Scene): Legend {
  const canvas  = document.createElement('canvas')
  canvas.width  = WIDTH
  canvas.height = HEIGHT

  const ctx     = canvas.getContext('2d')!

  const texture      = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.MeshBasicMaterial({
    map:         texture,
    transparent: true,
    depthTest:   false,
    depthWrite:  false,
  })

  // Sized in world units at a fixed distance in front of the camera, then pinned
  // to the top-left of the frustum at that distance.
  const distance    = 1
  const perspective = camera as THREE.PerspectiveCamera
  const fov         = (perspective.isPerspectiveCamera ? perspective.fov : 50) * Math.PI / 180
  const viewH       = 2 * distance * Math.tan(fov / 2)
  const viewW       = viewH * (perspective.aspect || 16 / 9)
  const planeH      = viewH * 0.42
  const planeW      = planeH * (WIDTH / HEIGHT)

  const mesh        = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), material)
  mesh.position.set(-viewW / 2 + planeW / 2 + viewW * 0.015, viewH / 2 - planeH / 2 - viewH * 0.02, -distance)
  mesh.renderOrder   = 1000
  mesh.frustumCulled = false
  camera.add(mesh)

  // A camera's children only render if the camera itself is in the graph being
  // rendered, and this one is passed to `render()` without ever being added.
  // Cheap to fix here and invisible to everything else.
  if (!camera.parent)
    scene.add(camera)

  let lastKey = ''

  return {
    layers: LAYERS,

    render (active) {
      // Repainting a canvas texture every frame is a GPU upload every frame, and
      // this changes only on a keypress.
      const key = LAYERS.map(l => active[l] ? '1' : '0').join('')
      if (key === lastKey)
        return
      lastKey = key

      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      ctx.fillStyle = 'rgba(6, 9, 18, 0.82)'
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)'
      ctx.lineWidth   = 2
      ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2)

      ctx.font      = '600 15px ui-monospace, monospace'
      ctx.fillStyle = '#22d3ee'
      ctx.fillText('PHYSICS LAYERS', 14, 28)
      ctx.font      = '13px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(200, 214, 240, 0.5)'
      ctx.fillText('0 clears  ·  dev build only', 14, 48)

      LAYERS.forEach((layer, i) => {
        const y  = 82 + i * ROW
        const on = !!active[layer]

        ctx.fillStyle = on ? SWATCH[layer] ?? '#ffffff' : 'rgba(120, 132, 158, 0.35)'
        ctx.fillRect(14, y - 10, 12, 12)

        ctx.font      = '14px ui-monospace, monospace'
        ctx.fillStyle = on ? 'rgba(232, 240, 255, 0.95)' : 'rgba(140, 152, 178, 0.55)'
        ctx.fillText(`${i + 1}`, 38, y)
        ctx.fillText(layer, 62, y)
      })

      texture.needsUpdate = true
    },

    setVisible (visible) {
      mesh.visible = visible
    },

    dispose () {
      mesh.removeFromParent()
      mesh.geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
