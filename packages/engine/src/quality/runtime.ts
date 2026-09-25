import * as THREE from 'three'
import { settingsStore } from 'Ƨ'
import type { SettingsState } from 'Ƨ'
import type { SunHandle } from '../modules/sun'
import { createQualityController, startupQualityPreference } from './controller'
import type { QualityPreference, QualitySettings } from './controller'


const PREFERENCES: readonly QualityPreference[] = [ 'auto', 'low', 'medium', 'high' ]

/**
 * `auto` resolution: at most this many device pixels per CSS pixel...
 *
 * A retina laptop at its native 2x draws four times the pixels of 1x through a
 * chain of a dozen full-screen HalfFloat passes, and the edge AA at the end of
 * that chain makes 1.5x hard to tell from 2x at racing speed. `native` is
 * still there for anyone who wants it.
 */
const AUTO_MAX_RATIO = 1.5

/** ...and never more than this many lines, whatever the display. */
const AUTO_MAX_LINES = 1440

type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/**
 * What the post chain is allowed to spend, resolved from the quality stage AND
 * the player's settings. The chain applies it; it never reads either source.
 */
export type PostBudget = {

  /** False draws the scene straight to the screen and skips the composer. */
  enabled:   boolean;
  level:     0 | 1 | 2;
  dof:       boolean;
  motion:    boolean;
  antialias: 'smaa' | 'fxaa' | 'off';
}

/** The `?quality=` dev override, else the saved setting. */
function initialPreference (settings: SettingsState): QualityPreference {
  const query = process.env.NODE_ENV !== 'production'
    ? new URLSearchParams(window.location.search).get('quality')
    : null
  if (PREFERENCES.includes(query as QualityPreference))
    return query as QualityPreference

  return settings.preset
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

/**
 * Device pixels per CSS pixel for a resolution setting.
 *
 * `stageScale` is the adaptive ladder's resolution step. It only ever applies
 * to the two policy settings: a player who typed "1080" gets 1080 lines.
 */
export function pixelRatioFor (
  resolution: SettingsState['resolution'],
  cssHeight: number,
  devicePixelRatio: number,
  stageScale = 1
): number {
  const dpr    = Math.max(0.5, devicePixelRatio || 1)
  const height = Math.max(1, cssHeight)

  if (resolution === 'native')
    return Math.min(dpr, 2) * stageScale

  if (resolution === 'auto')
    return Math.max(0.5, Math.min(dpr, AUTO_MAX_RATIO, AUTO_MAX_LINES / height)) * stageScale

  const lines = Number(resolution)
  return Math.max(0.25, Math.min(2, lines / height))
}

export type RendererQuality = {
  beginFrame(): void;
  endFrame(frameMs: number): void;
  settings(): QualitySettings;
  post(): PostBudget;
  setPreference(preference: QualityPreference): void;
  snapshot(): ReturnType<ReturnType<typeof createQualityController>['snapshot']>;
  dispose(): void;
}

type OptionsType = {
  renderer: THREE.WebGLRenderer;
  scene:    THREE.Scene;
  sun:      { current: SunHandle | null };

  /**
   * Resize everything that renders at the drawing buffer's resolution.
   *
   * The composer keeps its OWN pixel ratio, captured when it was built, so
   * `renderer.setPixelRatio` alone changed the canvas and left every one of
   * the chain's render targets at the ratio the page loaded with. The ladder's
   * resolution steps therefore never reached the dozen full-screen passes they
   * were meant to relieve. The shell owns the composer, so it does this part.
   */
  setPixelRatio: (ratio: number) => void;
  onPost?:       (budget: PostBudget) => void;
}

export function createRendererQuality (options: OptionsType): RendererQuality {
  const { renderer, scene, sun, setPixelRatio, onPost } = options
  const timer                                           = createGpuTimer(renderer)
  const _size                                           = new THREE.Vector2()
  const particleCounts                                  = new WeakMap<THREE.BufferGeometry, number>()

  let user                           = settingsStore.get()
  let stageSettings: QualitySettings
  let applied: QualitySettings | null = null
  let appliedRatio                    = -1
  let appliedShadow                   = -1
  let appliedPost: PostBudget | null  = null
  let cssHeight                       = renderer.domElement.clientHeight || window.innerHeight

  /** The stage's settings with the player's explicit choices laid over them. */
  function effective (stage: QualitySettings): QualitySettings {
    const shadowSize = user.shadows === 'off'
      ? 0
      : user.shadows === 'low'
        ? 1024
        : user.shadows === 'high'
          ? 2048
          : stage.shadowSize
    return { ...stage, shadowSize: shadowSize as QualitySettings['shadowSize'] }
  }

  function postBudget (stage: QualitySettings): PostBudget {
    const antialias = user.antialias === 'auto'
      ? stage.effects === 0 ? 'fxaa' : 'smaa'
      : user.antialias
    return {
      enabled: user.postEffects,
      level:   stage.effects,
      dof:     user.depthOfField && stage.effects === 2,
      motion:  user.motionBlur && stage.effects > 0,
      antialias,
    }
  }

  /**
   * Push the effective settings into the renderer, and ONLY the ones that moved.
   *
   * Two of them are expensive and both are visible: a pixel-ratio change
   * reallocates the drawing buffer and every render target the composer
   * holds, and a full `scene.traverse` walks the level. So a step that does
   * not touch resolution must not pay for one — that was the stutter you got
   * "every now and then", every time the tier moved.
   */
  function apply (stage: QualitySettings) {
    stageSettings = stage

    const next = effective(stage)
    const prev = applied
    applied       = next

    if (next.shadowSize !== appliedShadow) {
      appliedShadow = next.shadowSize
      sun.current?.setMapSize(next.shadowSize)
    }

    const ratio = pixelRatioFor(user.resolution, cssHeight, window.devicePixelRatio, next.resolutionScale)
    if (Math.abs(ratio - appliedRatio) > 1e-3) {
      appliedRatio = ratio
      setPixelRatio(ratio)
    }

    const budget = postBudget(next)
    if (!appliedPost || budget.enabled !== appliedPost.enabled || budget.level !== appliedPost.level ||
        budget.dof !== appliedPost.dof || budget.motion !== appliedPost.motion || budget.antialias !== appliedPost.antialias) {
      appliedPost = budget
      onPost?.(budget)
    }

    if (prev && prev.particleScale === next.particleScale && prev.lodScale === next.lodScale)
      return

    scene.traverse(object => {
      if (object instanceof THREE.Points) {
        const geometry = object.geometry
        const count    = particleCounts.get(geometry) ?? geometry.getAttribute('position')?.count ?? 0
        particleCounts.set(geometry, count)
        geometry.setDrawRange(0, Math.floor(count * next.particleScale))
      }
    })
  }

  const controller = createQualityController({
    preference:        initialPreference(user),
    initialPreference: startupQualityPreference(),
    onTransition:      transition => {
      apply(transition.settings)
      // Deliberately retained as well as exposed through __dev: remote console
      // captures often survive after a page has already been closed.
      console.info('[quality]', transition)
    },
  })
  apply(controller.snapshot().settings)

  // Live: the settings page is its own route, but the store is shared, so a
  // second tab — or a future in-game panel — lands without a remount.
  const unsubscribe = settingsStore.subscribe(next => {
    user = next
    controller.setPreference(next.preset)
    applied = null
    apply(controller.snapshot().settings)
  })

  return {
    beginFrame: () => timer.begin(),
    endFrame (frameMs) {
      // `renderer.getSize` reads the renderer's own record of its size.
      // `domElement.clientWidth` reads the DOM, which forces the browser to
      // flush style and layout — synchronously, inside the render loop, once
      // per frame, for a number the controller only uses to report pixel
      // counts. That is a layout thrash at 60 Hz.
      renderer.getSize(_size)
      controller.resize(_size.x, _size.y)

      // A 30 fps cap delivers 33 ms frames on purpose; measured against a
      // 60 Hz budget that reads as a machine drowning, and the ladder would
      // strip every effect off a game that is running exactly as asked.
      const capped = user.frameCap > 0 && user.frameCap < 60 ? 60 / user.frameCap : 1
      controller.frame(frameMs / capped, timer.end())

      // A fixed line count depends on how tall the window is, and the resize
      // observer only knows how to keep the ratio it was given.
      if (_size.y > 0 && Math.abs(_size.y - cssHeight) > 0.5) {
        cssHeight = _size.y
        apply(stageSettings)
      }
    },
    settings: () => applied ?? stageSettings,
    post:     () => appliedPost ?? postBudget(stageSettings),
    setPreference (next) {
      controller.setPreference(next)
      apply(controller.snapshot().settings)
    },
    snapshot: () => controller.snapshot(),
    dispose () {
      unsubscribe()
      timer.dispose()
    },
  }
}
