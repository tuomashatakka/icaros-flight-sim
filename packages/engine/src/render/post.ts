/**
 * The cinematic post chain, shared by every mode.
 *
 * This was `battle/post.ts` and battle's alone: race mounted with an empty
 * effects array and got bloom, which is why the two modes never looked like the
 * same game. The chain is one module now and both roots build it; a mode states
 * its grade and its budget, not its own pass list.
 *
 * Everything here comes out of `threejs-scene/modules/post`, which already ships
 * the toolbox. This module is the wiring and the tuning, not new shaders.
 *
 * Four constraints it is shaped by:
 *
 * - the grade pass runs in linear HDR and must land BEFORE `OutputPass`
 *   tone-maps, which `addPassBeforeOutput` guarantees for anything returned
 *   from `effects`;
 * - grain and chromatic aberration stay at 0 on the grade pass, because the
 *   dedicated passes own them and stacking both double-applies;
 * - the composer's shared depth texture is attached to BOTH of its render
 *   targets, so a pass that samples it while writing to either is a framebuffer
 *   feedback loop — which Chrome resolves by handing back a black frame,
 *   silently, with no thrown error. That is why `createMotionBlur` is absent and
 *   `createRadialBlur` reads speed off colour alone, and why `DofPass` blurs
 *   into a private target and copies the result out;
 * - the HUD is NOT in this scene. `mountBaseScene` renders it after the
 *   composer, which is what lets the depth buffer describe the world rather
 *   than a full-screen overlay plane sitting 4.35 units off the eye — with that
 *   in it every pixel reads as one distance and nothing ever blurs — and what
 *   keeps a touch control readable while the world behind it is defocused.
 *
 * `createGodRaysPass` is deliberately absent. With no dedicated occlusion buffer
 * bound it treats every bright pixel as a light, and the battle arena is
 * wall-to-wall emissives — the deck grid, the territory lines and the player's
 * own engine plume all radiate, smearing a lattice across the play area. Raising
 * the threshold to 0.97 narrowed it and did not fix it. The sky shader draws its
 * own sun bloom and halo, which is where that light reads from now.
 */

import * as THREE from 'three'
import type { Pass } from 'three/addons/postprocessing/Pass.js'
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { EffectContext, GradePass } from 'threejs-scene/modules/post'
import { createCinematicLUT, createGradePass } from 'threejs-scene/modules/post'
import { createAnamorphic, createChromaticAberration, createLUT, createRadialBlur } from 'threejs-scene/modules/post/webgl'
import { DofPass } from './dof-pass'
import type { ScenePost } from '../scenes/base'
import { reducedMotion } from '../lifecycle'


export type PostQuality = 'high' | 'low'

/**
 * `low` keeps the per-pixel colour passes — LUT, aberration, grade — which carry
 * most of the look for one texture read each, and drops the multi-tap ones and
 * the depth-of-field, which renders the scene a second time.
 */
export function resolveQuality (): PostQuality {
  if (typeof window === 'undefined')
    return 'low'

  if (process.env.NODE_ENV !== 'production') {
    const override = new URLSearchParams(window.location.search).get('post')
    if (override === 'low' || override === 'high')
      return override
  }

  const cores  = navigator.hardwareConcurrency ?? 4
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return !coarse && cores >= 6 ? 'high' : 'low'
}

export type ScenePostOptions = {

  /** Base grade. A mode's own look, stated once. */
  tint?:       THREE.ColorRepresentation;
  contrast?:   number;
  saturation?: number;
  vignette?:   number;
  quality?:    PostQuality;
}

export type ScenePostHandle = {

  /** Spread into `mountBaseScene`'s `post` slot. */
  readonly options: ScenePost;

  /**
   * Flash the frame. Hits and kills push colour and aberration outward for a
   * few frames; it decays on its own, so callers fire and forget.
   */
  pulse(strength: number, tint?: THREE.ColorRepresentation): void;

  /**
   * How the ship is moving, both normalised 0..1.
   *
   * `speed` is ground speed against the vehicle's top speed; `accel` is the
   * MAGNITUDE of its rate of change, which is what the heavy streak reads from.
   * Speed alone smears the frame for as long as you are quick, which is most of
   * a lap; acceleration only smears while the velocity is actually changing, so
   * a boost, a wall and a hard brake each get their own kick and a flat-out
   * straight is clean.
   */
  setMotion(speed: number, accel: number): void;

  /**
   * Where the lens is focused, in world units from the eye.
   *
   * Driven from whatever is under the pointer — see `focus-probe.ts`. Damped
   * here rather than by the caller so every mode racks at the same rate.
   */
  setFocus(distance: number): void;

  /** Runtime budget, independent of the safe startup choice. */
  setQuality(level: 0 | 1 | 2): void;
}

const BASE_TINT     = new THREE.Color('#e8eeff')
const BASE_CONTRAST = 1.02
const _tint         = new THREE.Color()

/** Focus rack rate, in e-folds per second. Slow enough to read as a lens. */
const FOCUS_DAMPING = 6

/**
 * Widest blur, in source pixels.
 *
 * Deliberately shallow. The point is a cinematic falloff on the far scenery, not
 * a macro lens on a vehicle somebody is trying to drive.
 */
const MAX_RADIUS = 7

/**
 * How far off the focal plane a thing must be to blur fully, world units.
 *
 * Proportional to the focus distance, because depth of field is: a lens focused
 * at four metres has centimetres of usable depth and one focused at three
 * hundred has most of a track in it. A flat range reads as a bug at one end or
 * the other, and always at the end you happen to be looking at.
 */
const focusRange = (focus: number) => 14 + focus * 0.85

export function createScenePost (options: ScenePostOptions = {}): ScenePostHandle {
  const baseTint     = new THREE.Color(options.tint ?? BASE_TINT)
  const baseContrast = options.contrast ?? BASE_CONTRAST
  const quality      = options.quality ?? resolveQuality()

  let level = quality === 'high' ? 2 : 1

  let grade:      GradePass | null  = null
  let radial:     ShaderPass | null = null
  let chromatic:  ShaderPass | null = null
  let anamorphic: Pass | null       = null
  let dof:        DofPass | null    = null

  // Decays toward 0 every frame; `pulse` only ever raises it, so overlapping
  // hits reinforce instead of cutting each other off.
  let flash     = 0
  let flashTint = new THREE.Color(baseTint)
  let speed     = 0
  let accel     = 0

  /** Where the lens is asked to focus, and where it actually is. */
  let focusTarget = 40
  let focus       = 40

  return {
    options: {
      // ON, for `DofPass` and nothing else. Attaching it is what invites the
      // feedback loop the header describes, so every other pass here keeps to
      // colour and the depth is read in exactly one place.
      depth: true,

      effects: (ctx: EffectContext) => {
        const passes: Pass[] = []

        // Horizontal streaks off the beams and engine glow — the single effect
        // that most reads as "lens". Multi-tap, so it is what `low` drops.
        anamorphic = createAnamorphic({ threshold: 0.72, scale: 2.4, tint: new THREE.Color('#8fb4ff') })
        anamorphic.enabled = level === 2
        passes.push(anamorphic)

        // Depth of field, off the buffer the frame was already drawn with.
        // First thing the budget drops: thirteen taps a pixel is cheap beside a
        // second draw list and it is not free.
        if (ctx.depthTexture && ctx.camera instanceof THREE.PerspectiveCamera) {
          dof = new DofPass(ctx.camera, ctx.depthTexture, ctx.width, ctx.height)
          dof.setFocus(focus, focusRange(focus))
          dof.setRadius(MAX_RADIUS)
          dof.enabled = level === 2
          passes.push(dof)
        }

        // Speed cue, toggled rather than dialled to zero: the shader normalises
        // by its accumulated weight, so `uWeight: 0` divides into a black frame
        // instead of a no-op. `uDecay` is the honest strength knob, and it opens
        // from a visually-null 0.25 so flipping `enabled` never pops.
        radial = createRadialBlur({ weight: 1, decay: 0.25, count: 10, exposure: 1 }) as ShaderPass
        radial.enabled = false
        passes.push(radial)

        passes.push(createLUT({ lut: createCinematicLUT(32, { contrast: 1.02, splitTone: 0.55, saturation: 1.02 }) }))

        chromatic = createChromaticAberration({ strength: 0.4 }) as ShaderPass
        passes.push(chromatic)

        grade = createGradePass({
          tint:       baseTint,
          contrast:   baseContrast,
          saturation: options.saturation ?? 1.07,
          vignette:   options.vignette ?? 0.28,
          grain:      0,
          chromatic:  0,
        })
        passes.push(grade)

        return passes
      },

      onFrame: frame => {
        grade?.setTime(frame.elapsed)

        flash = Math.max(0, flash - frame.delta * 3.2)

        if (dof) {
          dof.enabled = level === 2
          // Exponential rack, frame-rate independent. A lens that snapped would
          // read as a bug on every flick of the pointer across the horizon.
          focus += (focusTarget - focus) * (1 - Math.exp(-FOCUS_DAMPING * frame.delta))
          dof.setFocus(focus, focusRange(focus))
        }

        if (radial) {
          // Two contributions, and acceleration is the loud one. Nothing below
          // 60 % of top speed streaks on speed alone — otherwise the track is
          // permanently smeared just from driving it well.
          const cruise                 = Math.max(0, (speed - 0.6) / 0.4) * 0.55
          const surge                  = Math.min(1, accel) * 1.05
          const ramp                   = Math.min(1.35, cruise + surge)
          radial.enabled               = level > 0 && !reducedMotion() && ramp > 0.01
          radial.uniforms.uDecay.value = 0.25 + ramp * 0.62
        }

        if (grade) {
          _tint.copy(baseTint).lerp(flashTint, Math.min(1, flash))
          grade.uniforms.uTint.value.copy(_tint)
          grade.uniforms.uContrast.value = baseContrast + flash * 0.2
        }

        if (chromatic) {
          chromatic.enabled = level > 0
          // The aberration leans on acceleration too, so a hard launch pulls
          // colour apart at the edges the way the streak pulls luminance.
          chromatic.uniforms.uStrength.value = reducedMotion()
            ? 0
            : 0.4 + flash * 3.4 + Math.min(1, accel) * 1.6
        }
      },
    },

    pulse (strength, tint) {
      flash = Math.min(1.4, flash + strength)
      if (tint)
        flashTint = new THREE.Color(tint)
    },

    setMotion (nextSpeed, nextAccel) {
      speed = Math.max(0, Math.min(1, nextSpeed))
      accel = Math.max(0, nextAccel)
    },

    setFocus (distance) {
      if (Number.isFinite(distance) && distance > 0)
        focusTarget = distance
    },

    setQuality (value) {
      level = value
      if (anamorphic)
        anamorphic.enabled = level === 2
      if (dof)
        dof.enabled = level === 2
      if (chromatic)
        chromatic.enabled = level > 0
      if (radial && level === 0)
        radial.enabled = false
    },
  }
}
