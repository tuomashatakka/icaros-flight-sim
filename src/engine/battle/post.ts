/**
 * The battle arena's cinematic post chain.
 *
 * `mountBaseScene` has always built an EffectComposer and then handed it an
 * empty effects array — bloom and nothing else. Everything here comes out of
 * `threejs-scene/modules/post`, which already ships the whole toolbox; this
 * module is the wiring and the tuning, not new shaders.
 *
 * Three constraints this chain is shaped by:
 *
 * - the grade pass runs in linear HDR and must land BEFORE `OutputPass`
 *   tone-maps, which `addPassBeforeOutput` guarantees for anything returned
 *   from `effects`;
 * - grain and chromatic aberration stay at 0 on the grade pass, because the
 *   dedicated passes own them and stacking both double-applies;
 * - nothing here samples the composer's shared depth texture. `createMotionBlur`
 *   does, and because that texture is attached to BOTH of the composer's render
 *   targets, binding it while writing produces a framebuffer feedback loop —
 *   which renders the whole frame black, silently, with no thrown error.
 *   `createRadialBlur` gives the same speed read from colour alone.
 *
 * `createGodRaysPass` is deliberately absent for a related reason. With no
 * dedicated occlusion buffer bound it treats every bright pixel as a light, and
 * this arena is wall-to-wall emissives — the deck grid, the territory lines and
 * the player's own engine plume all radiate, smearing a lattice across the play
 * area. Raising the threshold to 0.97 narrowed it and did not fix it. The sky
 * shader draws its own sun bloom and halo, which is where that light reads from
 * now; wiring real shafts back in means rendering an occlusion pass first.
 *
 * `createDof` is gone too, and that one is a plain cost/benefit call. BokehPass
 * renders the whole scene a SECOND time to build its depth buffer, so on a
 * 600x600 deck with an instanced skyline it roughly doubles the frame's draw
 * cost — and it has to be tuned so gently (the chase camera sits 9 units off the
 * hull, which a real aperture would smear into mush) that the result is barely
 * visible. It also pushed a single frame past `dev-cli shot`'s timeout once a
 * match went live, which costs more than the effect was worth.
 */

import * as THREE from 'three'
import type { Pass } from 'three/addons/postprocessing/Pass.js'
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { EffectContext, GradePass } from 'threejs-scene/modules/post'
import { createCinematicLUT, createGradePass } from 'threejs-scene/modules/post'
import { createAnamorphic, createChromaticAberration, createLUT, createRadialBlur } from 'threejs-scene/modules/post/webgl'
import type { ScenePost } from '../scenes/base'
import { capVisualDelta } from '../render/cadence'


export type PostQuality = 'high' | 'low'

/**
 * `low` keeps the per-pixel colour passes — LUT, aberration, grade — which carry
 * most of the look for one texture read each, and drops the two multi-tap ones.
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

export type BattlePostHandle = {

  /** Spread into `mountBaseScene`'s `post` slot. */
  readonly options: ScenePost;

  /**
   * Flash the frame. Hits and kills push colour and aberration outward for a
   * few frames; it decays on its own, so callers fire and forget.
   */
  pulse(strength: number, tint?: THREE.ColorRepresentation): void;

  /** 0..1 — how hard the frame streaks outward. Ramped from ground speed. */
  setSpeed(speed: number): void;
}

const BASE_TINT     = new THREE.Color('#e8eeff')
const BASE_CONTRAST = 1.02
const _tint         = new THREE.Color()

export function createBattlePost (quality: PostQuality = resolveQuality()): BattlePostHandle {
  const heavy = quality === 'high'

  let grade:     GradePass | null  = null
  let radial:    ShaderPass | null = null
  let chromatic: ShaderPass | null = null

  // Decays toward 0 every frame; `pulse` only ever raises it, so overlapping
  // hits reinforce instead of cutting each other off.
  let flash     = 0
  let flashTint = new THREE.Color(BASE_TINT)
  let speed     = 0

  return {
    options: {
      // Deliberately off: see the module header. Nothing in this chain reads it,
      // and attaching it is what invites the feedback loop.
      depth: false,

      effects: (ctx: EffectContext) => {
        const passes: Pass[] = []

        // Horizontal streaks off the beams and engine glow — the single effect
        // that most reads as "lens". Multi-tap, so it is what `low` drops.
        if (heavy)
          passes.push(createAnamorphic({ threshold: 0.72, scale: 2.4, tint: new THREE.Color('#8fb4ff') }))

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
          tint:       BASE_TINT,
          contrast:   BASE_CONTRAST,
          saturation: 1.07,
          vignette:   0.28,
          grain:      0,
          chromatic:  0,
        })
        passes.push(grade)

        return passes
      },

      onFrame: (frame, ctx) => {
        grade?.setTime(frame.elapsed)

        flash = Math.max(0, flash - capVisualDelta(frame.delta) * 3.2)

        if (radial) {
          // Nothing below 60% of top speed streaks — otherwise the arena is
          // permanently smeared just from crossing the deck.
          const ramp                   = Math.max(0, (speed - 0.6) / 0.4)
          radial.enabled               = ramp > 0.01
          radial.uniforms.uDecay.value = 0.25 + ramp * 0.55
        }

        if (grade) {
          _tint.copy(BASE_TINT).lerp(flashTint, Math.min(1, flash))
          grade.uniforms.uTint.value.copy(_tint)
          grade.uniforms.uContrast.value = BASE_CONTRAST + flash * 0.2
        }

        if (chromatic)
          chromatic.uniforms.uStrength.value = 0.4 + flash * 3.4
      },
    },

    pulse (strength, tint) {
      flash = Math.min(1.4, flash + strength)
      if (tint)
        flashTint = new THREE.Color(tint)
    },

    setSpeed (value) {
      speed = Math.max(0, Math.min(1, value))
    },
  }
}
