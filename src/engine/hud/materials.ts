import * as THREE from 'three'


export type HoloUniforms = {
  uTime:    { value: number };
  uColor:   { value: THREE.Color };
  uOpacity: { value: number };
  uReveal:  { value: number };
  uFill:    { value: number };
  uScan:    { value: number };
  uGain:    { value: number };
}

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

export const HOLO = {
  cyan:    '#79f7ff',
  magenta: '#ff63b4',
  amber:   '#ffb347',
  violet:  '#be63ff',
  white:   '#dff6ff',
} as const

export function tickHolo (materials: Iterable<HoloMaterial>, elapsed: number): void {
  for (const material of materials)
    material.uniforms.uTime.value = elapsed
}
