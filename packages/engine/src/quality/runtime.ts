import * as THREE from 'three'
import type { SunHandle } from '../modules/sun'
import { createQualityController, startupQualityPreference } from './controller'
import type { QualityPreference, QualitySettings } from './controller'


const STORAGE_KEY                               = 'crash-velocity:quality'
const PREFERENCES: readonly QualityPreference[] = [ 'auto', 'low', 'medium', 'high' ]

type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

function savedPreference (): QualityPreference {
  const query = process.env.NODE_ENV !== 'production'
    ? new URLSearchParams(window.location.search).get('quality')
    : null
  if (PREFERENCES.includes(query as QualityPreference))
    return query as QualityPreference

  const saved = localStorage.getItem(STORAGE_KEY)
  return PREFERENCES.includes(saved as QualityPreference) ? saved as QualityPreference : 'auto'
}

function createGpuTimer (renderer: THREE.WebGLRenderer) {
  const gl  = renderer.getContext() as WebGL2RenderingContext
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
  let active: WebGLQuery | null = null
  const pending: WebGLQuery[] = []

  return {
    begin () {
      if (!ext || active)
        return
      active = gl.createQuery()
      if (active)
        gl.beginQuery(ext.TIME_ELAPSED_EXT, active)
    },
    end (): number | null {
      if (!ext)
        return null
      if (active) {
        gl.endQuery(ext.TIME_ELAPSED_EXT)
        pending.push(active)
        active = null
      }

      const query = pending[0]
      if (!query || !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
        return null
      pending.shift()

      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
      const nanos    = gl.getQueryParameter(query, gl.QUERY_RESULT) as number
      gl.deleteQuery(query)
      return disjoint ? null : nanos / 1_000_000
    },
    dispose () {
      if (active)
        gl.deleteQuery(active)
      for (const query of pending)
        gl.deleteQuery(query)
    },
  }
}

export type RendererQuality = {
  beginFrame(): void;
  endFrame(frameMs: number): void;
  settings(): QualitySettings;
  setPreference(preference: QualityPreference): void;
  snapshot(): ReturnType<ReturnType<typeof createQualityController>['snapshot']>;
  dispose(): void;
}

type OptionsType = {
  renderer:   THREE.WebGLRenderer;
  scene:      THREE.Scene;
  sun:        { current: SunHandle | null };
  onEffects?: (effects: 0 | 1 | 2) => void;
}

export function createRendererQuality (options: OptionsType): RendererQuality {
  const { renderer, scene, sun, onEffects } = options
  const timer                               = createGpuTimer(renderer)
  const _size                               = new THREE.Vector2()
  const particleCounts                      = new WeakMap<THREE.BufferGeometry, number>()
  const lodDistances                        = new WeakMap<THREE.LOD, number[]>()
  let appliedStage                        = -1
  let currentSettings: QualitySettings
  let applied: QualitySettings | null     = null

  /**
   * Push a stage's settings into the renderer, and ONLY the ones that moved.
   *
   * The ladder changes exactly one concern per step, and this used to apply all
   * six on every transition. Two of them are expensive and both are visible:
   * `setPixelRatio` + `setSize` reallocate the drawing buffer and every render
   * target the composer holds, and a full `scene.traverse` walks the level. So
   * a step from effects 2 to effects 1 — which does not touch resolution at all
   * — still rebuilt every framebuffer in the app, which is a multi-frame hitch
   * and a visible flash of the scene resizing. That is the stutter you get
   * "every now and then": every time the tier moved, whether or not the thing
   * it moved had anything to do with the screen.
   */
  function apply (settings: QualitySettings, stage: number) {
    if (stage === appliedStage)
      return

    const previous  = applied
    appliedStage    = stage
    currentSettings = settings
    applied         = settings

    if (previous?.effects !== settings.effects)
      onEffects?.(settings.effects)

    // Guarded inside `setMapSize` as well, but stated here so the rule reads
    // the same for every setting on this list.
    if (previous?.shadowSize !== settings.shadowSize)
      sun.current?.setMapSize(settings.shadowSize)

    if (previous?.resolutionScale !== settings.resolutionScale) {
      const ratio = Math.min(window.devicePixelRatio, 2) * settings.resolutionScale
      renderer.setPixelRatio(ratio)
      renderer.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight, false)
    }

    if (previous?.particleScale === settings.particleScale && previous?.lodScale === settings.lodScale)
      return

    scene.traverse(object => {
      if (object instanceof THREE.Points) {
        const geometry = object.geometry
        const count    = particleCounts.get(geometry) ?? geometry.getAttribute('position')?.count ?? 0
        particleCounts.set(geometry, count)
        geometry.setDrawRange(0, Math.floor(count * settings.particleScale))
      }
      if (object instanceof THREE.LOD) {
        const distances = lodDistances.get(object) ?? object.levels.map(level => level.distance)
        lodDistances.set(object, distances)
        object.levels.forEach((level, index) => {
          level.distance = distances[index] * settings.lodScale
        })
      }
    })
  }

  const preference = savedPreference()
  const controller = createQualityController({
    preference,
    initialPreference: startupQualityPreference(),
    onTransition:      transition => {
      apply(transition.settings, transition.to)
      // Deliberately retained as well as exposed through __dev: remote console
      // captures often survive after a page has already been closed.
      console.info('[quality]', transition)
    },
  })
  const initial = controller.snapshot()
  currentSettings = initial.settings
  apply(initial.settings, initial.stage)

  return {
    beginFrame: () => timer.begin(),
    endFrame (frameMs) {
      // `renderer.getSize` reads the renderer's own record of its size.
      // `domElement.clientWidth` reads the DOM, which forces the browser to
      // flush style and layout — synchronously, inside the render loop, once
      // per frame, for a number the controller only uses to report pixel
      // counts. That is a layout thrash at 60 Hz and it is exactly the kind of
      // thing that shows up as intermittent jank on a machine with anything
      // else going on.
      renderer.getSize(_size)
      controller.resize(_size.x, _size.y)
      controller.frame(frameMs, timer.end())
    },
    settings: () => currentSettings,
    setPreference (next) {
      localStorage.setItem(STORAGE_KEY, next)
      controller.setPreference(next)

      const snapshot = controller.snapshot()
      apply(snapshot.settings, snapshot.stage)
    },
    snapshot: () => controller.snapshot(),
    dispose:  () => timer.dispose(),
  }
}
