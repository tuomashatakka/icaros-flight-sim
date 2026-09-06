import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'


/**
 * Depth of field, from the composer's own depth buffer.
 *
 * Written here rather than taken from `createDof`, which wraps three's
 * `BokehPass`, for two reasons and only the second one is about performance.
 *
 * `BokehPass` builds its depth by rendering the WHOLE SCENE a second time
 * through an override material. In this app that produced visible garbage — a
 * nameplate's canvas texture blown up across the frame — because the scene is
 * full of objects whose materials are not interchangeable with a depth
 * material, and it cost a second full draw list to get there. The composer is
 * already carrying a `DepthTexture` written by the pass that drew the frame; the
 * blur wants that, not another render.
 *
 * The catch, and the reason nothing in this codebase sampled that texture
 * before: it is attached to BOTH of the composer's render targets, so binding it
 * while writing to either is a framebuffer feedback loop — which Chrome resolves
 * by handing back a black frame, silently. So this renders into a target of its
 * own, which has no depth attachment, and then copies that result into the
 * composer's write buffer. Two fullscreen quads, no second draw list, no
 * feedback.
 *
 * The HUD is not in the scene this measures — `mountBaseScene` draws it after
 * the composer — so the depth here is the world's. That matters: the screen
 * layer is a plane 4.35 units off the eye covering every pixel, and with it in
 * the buffer the entire frame would read as one distance and nothing would ever
 * blur.
 */

const VERTEX = /* glsl */`
varying vec2 vUv;
void main () {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * A 12-tap ring plus the centre, radius scaled by the circle of confusion.
 *
 * A ring rather than a disc because a disc of the same tap count is visibly
 * under-sampled at the radii that read as bokeh, and a ring at this size is what
 * gives the highlights their shape. Taps are weighted by their OWN blur so a
 * sharp foreground does not smear itself over the background behind it — the
 * classic depth-of-field artefact, and the one people actually notice.
 */
const FRAGMENT = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2  uTexel;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uRange;
uniform float uMaxRadius;

varying vec2 vUv;

const int TAPS = 12;

float eyeDepth (vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  // A depth of exactly 1 is the cleared far plane — sky, with nothing in it.
  // Treated as the far plane rather than as a division by zero.
  if (d >= 1.0) return uFar;
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

float circleOfConfusion (float depth) {
  return clamp(abs(depth - uFocus) / max(uRange, 0.001), 0.0, 1.0);
}

void main () {
  float depth  = eyeDepth(vUv);
  float centre = circleOfConfusion(depth);
  vec4  source = texture2D(tDiffuse, vUv);

  if (centre < 0.02) {
    gl_FragColor = source;
    return;
  }

  float radius = centre * uMaxRadius;
  vec4  sum    = source;
  float weight = 1.0;

  for (int i = 0; i < TAPS; i++) {
    float angle = float(i) * 0.5235988; // 2*pi / 12
    vec2  offset = vec2(cos(angle), sin(angle)) * radius * uTexel;
    vec2  uv     = clamp(vUv + offset, vec2(0.0), vec2(1.0));

    // A tap that is sharper than this pixel belongs to something in focus in
    // front of it, and letting it in is what bleeds a crisp edge outward.
    float tap = circleOfConfusion(eyeDepth(uv));
    float w   = smoothstep(0.0, 0.35, tap / max(centre, 0.001));
    sum    += texture2D(tDiffuse, uv) * w;
    weight += w;
  }

  gl_FragColor = sum / weight;
}
`

const COPY_FRAGMENT = /* glsl */`
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main () {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`

export class DofPass extends Pass {
  private readonly material:     THREE.ShaderMaterial
  private readonly copyMaterial: THREE.ShaderMaterial
  private readonly quad:         FullScreenQuad
  private readonly copyQuad:     FullScreenQuad
  private readonly target:       THREE.WebGLRenderTarget

  constructor (camera: THREE.PerspectiveCamera, depthTexture: THREE.Texture, width: number, height: number) {
    super()

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:   { value: null },
        tDepth:     { value: depthTexture },
        uTexel:     { value: new THREE.Vector2(1 / Math.max(1, width), 1 / Math.max(1, height)) },
        uNear:      { value: camera.near },
        uFar:       { value: camera.far },
        uFocus:     { value: 40 },
        uRange:     { value: 60 },
        uMaxRadius: { value: 7 },
      },
      vertexShader:   VERTEX,
      fragmentShader: FRAGMENT,
    })

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms:       { tDiffuse: { value: null }},
      vertexShader:   VERTEX,
      fragmentShader: COPY_FRAGMENT,
    })

    this.quad     = new FullScreenQuad(this.material)
    this.copyQuad = new FullScreenQuad(this.copyMaterial)

    // No depth attachment, deliberately: this is the target the blur may write
    // to while the composer's shared depth texture is bound for reading.
    this.target = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      minFilter:   THREE.LinearFilter,
      magFilter:   THREE.LinearFilter,
      type:        THREE.HalfFloatType,
      depthBuffer: false,
    })
  }

  /** Focal distance and how quickly it falls off, both in world units. */
  setFocus (focus: number, range: number): void {
    this.material.uniforms.uFocus.value = focus
    this.material.uniforms.uRange.value = Math.max(1, range)
  }

  /** Widest blur, in source pixels at the pass's own resolution. */
  setRadius (radius: number): void {
    this.material.uniforms.uMaxRadius.value = Math.max(0, radius)
  }

  setSize (width: number, height: number): void {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    this.target.setSize(w, h)
    this.material.uniforms.uTexel.value.set(1 / w, 1 / h)
  }

  render (
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture

    renderer.setRenderTarget(this.target)
    renderer.clear()
    this.quad.render(renderer)

    this.copyMaterial.uniforms.tDiffuse.value = this.target.texture
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer)
    if (this.clear)
      renderer.clear()
    this.copyQuad.render(renderer)
  }

  dispose (): void {
    this.material.dispose()
    this.copyMaterial.dispose()
    this.quad.dispose()
    this.copyQuad.dispose()
    this.target.dispose()
  }
}
