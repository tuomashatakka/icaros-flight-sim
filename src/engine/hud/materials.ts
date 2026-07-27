import * as THREE from 'three'

/**
 * The holographic look, as one material.
 *
 * Every HUD element shares this shader so the whole panel reads as one
 * projection rather than a pile of glowing quads. Three decisions matter:
 *
 * - `AdditiveBlending` + `depthWrite: false` — a hologram adds light to what is
 *   behind it, it does not occlude it, and additive fragments that wrote depth
 *   would z-fight each other in the order they happened to be drawn.
 * - `toneMapped: false` — the composer tone-maps once at OutputPass. Letting the
 *   HUD through that curve would drag its colour back under the bloom threshold
 *   (0.85-0.92 per level), which is exactly what we want it to cross.
 * - `depthTest: false` on the cockpit set, because the canopy sits inside the
 *   hull and would otherwise be clipped by it.
 */
export type HoloUniforms = {
  uTime:    { value: number };
  uColor:   { value: THREE.Color };
  uOpacity: { value: number };

  /** 0..1 wipe, drives the build-in when a view is entered. */
  uReveal: { value: number };

  /** Angular/linear fill for gauges; ignored by plain geometry. */
  uFill: { value: number };

  /** Scanline density in UV space. 0 disables them. */
  uScan: { value: number };

  /** Extra brightness multiplier — how hard this element pushes into bloom. */
  uGain: { value: number };
}

const VERTEX = /* glsl */`
varying vec2 vUv;

void main () {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * `vUv.x` is the fill axis for bars and the angular sweep for arcs — the arc
 * geometry is built with u running along the sweep precisely so one shader can
 * serve both without a branch.
 */
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
  // Unfilled portion of a gauge stays visible as a dim track, so the element
  // keeps its shape at zero rather than disappearing.
  float filled = step(vUv.x, uFill);
  float track  = mix(0.18, 1.0, filled);

  // Scanlines ride world-ish time, not uv alone, so they drift.
  float scan = uScan > 0.0
    ? 0.82 + 0.18 * sin((vUv.y * uScan + uTime * 0.6) * 6.2831853)
    : 1.0;

  // A slow, low-amplitude flicker. Anything stronger reads as a broken monitor
  // rather than a projection.
  float flicker = 0.94 + 0.06 * sin(uTime * 11.0) * sin(uTime * 3.7);

  // Build-in wipe: a bright leading edge sweeping up the element.
  float wipe = smoothstep(uReveal - 0.14, uReveal, vUv.y);
  float edge = smoothstep(0.06, 0.0, abs(vUv.y - uReveal)) * 1.6;

  float alpha = uOpacity * track * scan * flicker * (1.0 - wipe);
  vec3  rgb   = uColor * uGain * (1.0 + edge);

  if (alpha < 0.002) discard;

  gl_FragColor = vec4(rgb * alpha, alpha);
}
`

export type HoloMaterialOptions = {
  color?:   THREE.ColorRepresentation;
  opacity?: number;
  scan?:    number;
  gain?:    number;
  fill?:    number;

  /** Cockpit elements sit inside the hull and must not be depth-clipped by it. */
  depthTest?: boolean;
}

export type HoloMaterial = THREE.ShaderMaterial & { uniforms: HoloUniforms }

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

/**
 * The HUD palette. Kept in sync by hand with the `--holo-*` custom properties in
 * `globals.css` — the DOM chrome and the projection have to read as one system,
 * and there is no build step that could share them automatically.
 */
export const HOLO = {
  cyan:    '#79f7ff',
  magenta: '#ff63b4',
  amber:   '#ffb347',
  violet:  '#be63ff',
  white:   '#dff6ff',
} as const

/** Advance every holo material's clock in one pass. */
export function tickHolo (materials: Iterable<HoloMaterial>, elapsed: number): void {
  for (const material of materials)
    material.uniforms.uTime.value = elapsed
}
