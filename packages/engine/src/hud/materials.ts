import * as THREE from 'three'
import { HUD_GLASS_TINT, HUD_HOLO } from './tokens'


export type HoloUniforms = {
  uTime:    { value: number };
  uColor:   { value: THREE.Color };
  uOpacity: { value: number };
  uReveal:  { value: number };
  uFill:    { value: number };
  uScan:    { value: number };
  uGain:    { value: number };
}


/**
 * The two chunks a HUD shader has to end with, and why.
 *
 * The HUD is drawn AFTER the composer now — see `mountBaseScene` — so nothing
 * downstream tone-maps it any more. Inside the composer it was written raw into
 * a linear HDR buffer and `OutputPass` applied ACES and the sRGB encode to the
 * sum; drawn straight to the canvas the same raw value is read as sRGB, which
 * lifts every dark in the visor and turns the panels into pale washes. A
 * `ShaderMaterial` does not get these appended for it the way a built-in
 * material does, so they are spelled out — with `toneMapped: true`, which is
 * what makes three define them at all.
 */
const OUTPUT = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`

const VERTEX = /* glsl */`
varying vec2 vUv;

void main () {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */`
uniform float uTime;
uniform vec3  uColor;
uniform float uOpacity;
uniform float uReveal;
uniform float uFill;
uniform float uScan;
uniform float uGain;

varying vec2 vUv;

void main () {
  float filled = step(vUv.x, uFill);
  float track  = mix(0.18, 1.0, filled);
  float scan = uScan > 0.0
    ? 0.82 + 0.18 * sin((vUv.y * uScan + uTime * 0.6) * 6.2831853)
    : 1.0;
  float flicker = 0.94 + 0.06 * sin(uTime * 11.0) * sin(uTime * 3.7);
  float wipe = smoothstep(uReveal - 0.14, uReveal, vUv.y);
  float edge = smoothstep(0.06, 0.0, abs(vUv.y - uReveal)) * 1.6;
  float alpha = uOpacity * track * scan * flicker * (1.0 - wipe);
  vec3 rgb = uColor * uGain * (1.0 + edge);

  if (alpha < 0.002) discard;
  gl_FragColor = vec4(rgb * alpha, alpha);
}
`

export type HoloMaterialOptions = {
  color?:     THREE.ColorRepresentation;
  opacity?:   number;
  scan?:      number;
  gain?:      number;
  fill?:      number;
  depthTest?: boolean;
}

export type HoloMaterial = THREE.ShaderMaterial & { uniforms: HoloUniforms }

/** Additive hologram shader shared by arena scenery that still uses emissive strips. */
export function createHoloMaterial (options: HoloMaterialOptions = {}): HoloMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:    { value: 0 },
      uColor:   { value: new THREE.Color(options.color ?? HOLO.cyan) },
      uOpacity: { value: options.opacity ?? 1 },
      uReveal:  { value: 1 },
      uFill:    { value: options.fill ?? 1 },
      uScan:    { value: options.scan ?? 0 },
      uGain:    { value: options.gain ?? 1.1 },
    } satisfies HoloUniforms,
    vertexShader:   VERTEX,
    fragmentShader: FRAGMENT,
    transparent:    true,
    blending:       THREE.AdditiveBlending,
    depthWrite:     false,
    depthTest:      options.depthTest ?? false,
    toneMapped:     false,
    side:           THREE.DoubleSide,
  }) as HoloMaterial
}

const HOLO = HUD_HOLO

export { HOLO }

export function tickHolo (materials: Iterable<HoloMaterial>, elapsed: number): void {
  for (const material of materials)
    material.uniforms.uTime.value = elapsed
}

export type HudFacetUniforms = {
  uMap:     { value: THREE.Texture };
  uTime:    { value: number };
  uAccent:  { value: THREE.Color };
  uOpacity: { value: number };

  /** 0 = not yet arrived, 1 = fully present. Driven by `hud/transition.ts`. */
  uReveal: { value: number };

  /**
   * How defocused the visor is, 0..1.
   *
   * The HUD is drawn after the composer, so the scene's depth of field cannot
   * reach it — and should not: a blurred touch control is a broken touch
   * control. But a visor that stays razor sharp while the world racks past it
   * reads as a sticker on the lens rather than as glass a few centimetres from
   * the eye. So the FACETS carry their own, driven by how far the focal plane
   * has travelled from them, and the screen layer carries none.
   */
  uSoftness: { value: number };
}

export type HudFacetMaterial = THREE.ShaderMaterial & { uniforms: HudFacetUniforms }

const HUD_VERTEX = /* glsl */`
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vViewNormal;

void main () {
  vUv = uv;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -viewPosition.xyz;
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewPosition;
}
`

const HUD_FRAGMENT = /* glsl */`
uniform sampler2D uMap;
uniform float uTime;
uniform vec3 uAccent;
uniform float uOpacity;
uniform float uReveal;
uniform float uSoftness;

varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vViewNormal;

float hash (vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main () {
  // Panels scan in from the bottom of their own surface. Everything below the
  // front is discarded outright rather than faded, so the arrival reads as the
  // surface being written rather than as an opacity ramp.
  float front = uReveal * 1.16 - 0.08;
  if (vUv.y > front) discard;
  float sweep = smoothstep(0.075, 0.0, front - vUv.y) * step(uReveal, 0.999);

  float facing = abs(dot(normalize(vViewNormal), normalize(vViewPosition)));
  vec2 radial = normalize(vUv - 0.5 + vec2(0.00001));
  // The chromatic split widens while the panel is arriving and resolves as it
  // settles — the same separation the settled facet carries, just overdriven.
  float split = mix(0.0028, 0.0011, facing) + (1.0 - uReveal) * 0.02;

  // Four diagonal taps, radius driven by the focal plane. At zero softness the
  // offset is zero and this is the single centre tap it always was.
  float blur  = uSoftness * 0.004;
  vec4 source = texture2D(uMap, vUv);
  if (blur > 0.0001) {
    source = (source
      + texture2D(uMap, vUv + vec2( blur,  blur))
      + texture2D(uMap, vUv + vec2(-blur,  blur))
      + texture2D(uMap, vUv + vec2( blur, -blur))
      + texture2D(uMap, vUv + vec2(-blur, -blur))) * 0.2;
  }

  vec3 signal = vec3(
    texture2D(uMap, vUv + radial * split).r,
    source.g,
    texture2D(uMap, vUv - radial * split).b
  );

  float luminance = max(signal.r, max(signal.g, signal.b));
  float glyph = smoothstep(0.08, 0.58, luminance);
  float scan = 0.94 + 0.06 * sin((vUv.y * 260.0 - uTime * 0.7) * 6.2831853);
  float grain = hash(floor(gl_FragCoord.xy) + floor(uTime * 18.0)) - 0.5;
  float edgeGain = pow(1.0 - facing, 2.0);

  vec3 color = signal * (scan + grain * 0.055);
  color += uAccent * glyph * (0.08 + edgeGain * 0.18);
  color += uAccent * sweep * 2.2;

  // A glow the panels used to get for free.
  //
  // Inside the composer every lit glyph fed UnrealBloomPass, which is most of
  // what made the visor read as light rather than as printing. Drawn after it,
  // they get none — so the bloom is faked where it is cheapest to fake: lift
  // the bright end of the signal against itself, which spreads nothing but does
  // put the halo back on the strokes that had one.
  color += signal * glyph * (0.34 + edgeGain * 0.3);
  float alpha = source.a * uOpacity * mix(0.28, 1.0, glyph);
  alpha *= 0.96 + grain * 0.08;
  alpha = max(alpha, sweep * 0.75);

  if (alpha < 0.002)
    discard;
  gl_FragColor = vec4(color * (1.08 + edgeGain * 0.22), alpha);
${OUTPUT}
}
`

type CreateHudFacetMaterialProps = {
  map:      THREE.Texture;
  accent:   THREE.ColorRepresentation;
  opacity?: number;
}

export function createHudFacetMaterial ({
  map,
  accent,
  opacity = 0.96,
}: CreateHudFacetMaterialProps): HudFacetMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap:     { value: map },
      uTime:    { value: 0 },
      uAccent:  { value: new THREE.Color(accent) },
      uOpacity:  { value: opacity },
      uReveal:   { value: 0 },
      uSoftness: { value: 0 },
    } satisfies HudFacetUniforms,
    vertexShader:   HUD_VERTEX,
    fragmentShader: HUD_FRAGMENT,
    transparent:    true,
    depthTest:      false,
    depthWrite:     false,
    toneMapped:     true,
    side:           THREE.DoubleSide,
  }) as HudFacetMaterial
}

type HudGlassUniforms = {
  uTime:  { value: number };
  uColor: { value: THREE.Color };
}

export type HudGlassMaterial = THREE.ShaderMaterial & { uniforms: HudGlassUniforms }

const HUD_GLASS_FRAGMENT = /* glsl */`
uniform float uTime;
uniform vec3 uColor;

varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vViewNormal;

void main () {
  float facing = abs(dot(normalize(vViewNormal), normalize(vViewPosition)));
  float fresnel = pow(1.0 - facing, 2.4);
  float sweep = 0.5 + 0.5 * sin((vUv.y * 8.0 - uTime * 0.08) * 6.2831853);
  float alpha = 0.018 + fresnel * 0.16 + sweep * 0.008;
  gl_FragColor = vec4(uColor * (0.42 + fresnel * 1.35), alpha);
${OUTPUT}
}
`

export function createHudGlassMaterial (): HudGlassMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: new THREE.Color(HUD_GLASS_TINT) },
    } satisfies HudGlassUniforms,
    vertexShader:   HUD_VERTEX,
    fragmentShader: HUD_GLASS_FRAGMENT,
    transparent:    true,
    blending:       THREE.AdditiveBlending,
    depthTest:      false,
    depthWrite:     false,
    toneMapped:     true,
    side:           THREE.DoubleSide,
  }) as HudGlassMaterial
}

// perf: one sampled texture and three neighbouring texels per HUD fragment; no per-frame allocation.
