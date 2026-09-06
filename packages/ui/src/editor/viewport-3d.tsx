'use client'

import * as THREE from 'three'
import { useEffect, useRef } from 'react'
import { buildProps, isSharedPropGeometry } from 'Σlevels/props'
import { gatePosts, guideRail, ribbonWalls, roadMaterial } from 'Σlevels/shared'
import type { CompiledRace } from './compile'
import type { EditorDocument } from './document'
import styles from './map-editor.module.css'


/**
 * The circuit, in three dimensions, in the forge.
 *
 * Built out of the SAME builders `Σlevels/draft` uses to draw a test drive —
 * `roadMaterial`, `ribbonWalls`, `gatePosts`, `buildProps` — so the preview and
 * the thing you are about to drive are the same geometry from the same vertex
 * strip. A preview assembled from lookalikes is a preview that agrees with the
 * game right up until somebody changes one of them.
 *
 * It is a preview and not a game: there is no rapier world, no ship, no post
 * chain and no HUD. Press Test drive for those.
 *
 * The camera is an orbit — drag to turn, wheel to dolly — written here rather
 * than pulled from `OrbitControls` because it needs exactly two gestures and
 * the addon brings its own event plumbing, damping loop and dispose contract
 * for the other eight.
 */

type Viewport3DProps = {
  document: EditorDocument;
  compiled: CompiledRace | null;
}

/** Where the orbit starts: behind and above, looking at the origin. */
const START_YAW    = 0.6
const START_PITCH  = 0.85
const START_RADIUS = 520

export function Viewport3D ({ document: doc, compiled }: Viewport3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  // The scene is rebuilt whenever the compiled ribbon or the props change, and
  // nothing else: dragging the camera must not touch React at all, or the
  // orbit re-renders the tree sixty times a second.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !compiled)
      return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(host.clientWidth || 800, host.clientHeight || 480, false)
    renderer.setClearColor(new THREE.Color(doc.environment.background))
    renderer.domElement.className = styles.canvas3d
    host.replaceChildren(renderer.domElement)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, 16 / 9, 1, 6000)

    scene.add(new THREE.HemisphereLight(0x9fb6ff, 0x121722, 1.4))

    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(180, 300, 120)
    scene.add(key)

    const road      = new THREE.Mesh(compiled.geometry, roadMaterial('#1a1d2a', 0.25, 0.7))
    road.position.y = -0.05
    scene.add(road)
    scene.add(ribbonWalls(compiled.vertices, { height: 6, face: '#161a26', cap: '#58f7ef' }))
    scene.add(guideRail(compiled.curve.getSpacedPoints(360), '#58f7ef', 0.4, 0.25))
    scene.add(gatePosts(compiled.spec.waypoints, compiled.spec.width / 2 + 1.2, '#ffd06a'))
    if (doc.props.length)
      scene.add(buildProps(doc.props))

    // Framed on the track's own bounds, so a big circuit and a small one both
    // arrive filling the view rather than as a speck or off the edge.
    compiled.geometry.computeBoundingSphere()

    const bounds = compiled.geometry.boundingSphere
    const focus  = bounds?.center.clone() ?? new THREE.Vector3()
    let radius = bounds ? Math.max(bounds.radius * 1.9, 80) : START_RADIUS
    let yaw    = START_YAW
    let pitch  = START_PITCH

    const place = () => {
      const horizontal = Math.cos(pitch) * radius
      camera.position.set(
        focus.x + Math.sin(yaw) * horizontal,
        focus.y + Math.sin(pitch) * radius,
        focus.z + Math.cos(yaw) * horizontal
      )
      camera.lookAt(focus)
    }

    let dragging = false
    let lastX    = 0
    let lastY    = 0

    const onDown = (event: PointerEvent) => {
      dragging = true
      lastX    = event.clientX
      lastY    = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const onMove = (event: PointerEvent) => {
      if (!dragging)
        return
      yaw   -= (event.clientX - lastX) * 0.006
      // Clamped short of the poles: at exactly vertical the look-at basis is
      // degenerate and the view rolls over.
      pitch  = Math.max(0.08, Math.min(1.45, pitch + (event.clientY - lastY) * 0.005))
      lastX  = event.clientX
      lastY  = event.clientY
      place()
      renderer.render(scene, camera)
    }
    const onUp = () => {
      dragging = false
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      radius = Math.max(40, Math.min(4000, radius * (event.deltaY > 0 ? 1.12 : 1 / 1.12)))
      place()
      renderer.render(scene, camera)
    }

    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointercancel', onUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    const resize = () => {
      const width  = host.clientWidth || 800
      const height = host.clientHeight || 480
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
      place()
      renderer.render(scene, camera)
    }

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(host)
    resize()

    return () => {
      observer?.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointercancel', onUp)
      renderer.domElement.removeEventListener('wheel', onWheel)

      // Materials are all this preview's. Geometry is not: the road belongs to
      // the compile memo and the prop shapes belong to a module-level cache
      // every later scene reuses, so disposing either would take them out of
      // the next build — and this rebuilds on every edit.
      scene.traverse(object => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh)
          return
        if (mesh.geometry !== compiled.geometry && !isSharedPropGeometry(mesh.geometry))
          mesh.geometry.dispose()
        for (const material of Array.isArray(mesh.material) ? mesh.material : [ mesh.material ])
          material?.dispose()
      })
      renderer.dispose()
      renderer.forceContextLoss()
      host.replaceChildren()
    }
  }, [ compiled, doc.props, doc.environment.background ])

  if (!compiled)
    return <div className={ styles.empty3d }>The 3D view shows a circuit. Switch the map kind to Circuit.</div>

  return <div ref={ hostRef } className={ styles.host3d } />
}
