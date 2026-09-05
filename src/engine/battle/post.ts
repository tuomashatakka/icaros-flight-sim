/**
 * The battle arena's cinematic post chain.
 *
 * Low and off never build this chain: the renderer's ACES tone mapping is their
 * basic grade. Medium and high opt into one fused grade, with expensive lens
 * effects added only where the shared quality budget permits them.
 *
 * Three constraints this chain is shaped by:
 *
 * - the grade pass runs in linear HDR and must land BEFORE `OutputPass`
 *   tone-maps, which `addPassBeforeOutput` guarantees for anything returned
 *   from `effects`;
 * - colour operations, hit flash and chromatic offset share the grade pass;
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
import type { EffectContext, GradePass, PostProcessingBloom } from 'threejs-scene/modules/post'
import { createGradePass } from 'threejs-scene/modules/post'
import { createAnamorphic, createRadialBlur } from 'threejs-scene/modules/post/webgl'
import type { ScenePost } from '../scenes/base'
import { RENDERER_QUALITY, resolveRendererQuality } from '../renderer-quality'
import type { RendererQuality } from '../renderer-quality'


export type BattlePostHandle = {

  /** Spread into `mountBaseScene`'s `post` slot. */
  readonly options?: ScenePost;

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

export function createBattlePost (
  quality: RendererQuality = resolveRendererQuality(),
  bloom: PostProcessingBloom = {}
): BattlePostHandle {
  const preset = RENDERER_QUALITY[quality]

  let grade:     GradePass | null  = null
  let radial:    ShaderPass | null = null

  // Decays toward 0 every frame; `pulse` only ever raises it, so overlapping
  // hits reinforce instead of cutting each other off.
  let flash     = 0
  let flashTint = new THREE.Color(BASE_TINT)
  let speed     = 0

  const options: ScenePost | undefined = preset.grade || preset.bloom || preset.anamorphic || preset.radialBlur
    ? {
      bloom: preset.bloom ? bloom : false,
      // Deliberately off: see the module header. Nothing in this chain reads it,
      // and attaching it is what invites the feedback loop.
      depth: false,

      effects: (ctx: EffectContext) => {
        const passes: Pass[] = []

        // Horizontal streaks off the beams and engine glow — the single effect
        // that most reads as "lens". Multi-tap, so it is what `low` drops.
        if (preset.anamorphic)
          passes.push(createAnamorphic({ threshold: 0.72, scale: 2.4, tint: new THREE.Color('#8fb4ff') }))

        // Speed cue, toggled rather than dialled to zero: the shader normalises
        // by its accumulated weight, so `uWeight: 0` divides into a black frame
        // instead of a no-op. `uDecay` is the honest strength knob, and it opens
        // from a visually-null 0.25 so flipping `enabled` never pops.
        if (preset.radialBlur) {
          radial = createRadialBlur({ weight: 1, decay: 0.25, count: 10, exposure: 1 }) as ShaderPass
          radial.enabled = false
          passes.push(radial)
        }

        // Tint, contrast, saturation, vignette, hit flash and optional colour
        // offset stay fused in one traversal. Separate LUT and CA passes were
        // the same pixels travelling through memory two more times.
        if (preset.grade) {
          grade = createGradePass({
            tint:       BASE_TINT,
            contrast:   BASE_CONTRAST,
            saturation: 1.07,
            vignette:   0.28,
            grain:      0,
            chromatic:  preset.chromatic,
          })
          passes.push(grade)
        }

        return passes
      },

      onFrame: (frame, ctx) => {
        grade?.setTime(frame.elapsed)

        flash = Math.max(0, flash - frame.delta * 3.2)

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

        if (grade)
          grade.uniforms.uChromatic.value = preset.chromatic > 0 ? preset.chromatic + flash * 3.4 : 0
      },
    }
    : undefined

  return {
    options,

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
