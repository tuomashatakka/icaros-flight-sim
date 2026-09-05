/**
 * The cockpit HUD's palette, handed to the DOM as custom properties.
 *
 * `Σhud/tokens` is an authored design system — instrument hues, glass, the
 * two-pass glow, bracket geometry — and until now nothing outside the canvas
 * consumed it, so every DOM surface in the app drifted its own way. This is the
 * bridge: one object, spread onto a root element, and the whole subtree can
 * reach the same values the visor paints with.
 *
 * DERIVED, never copied. `tokens.ts` documents itself as the only table allowed
 * to hold hex literals, and a second copy here would be a palette that silently
 * disagrees with the cockpit after the first retheme.
 */

import {
  HUD_BAR_SEGMENTS, HUD_BRACKET_INSET, HUD_BRACKET_LEN, HUD_CAPTION_SIZE,
  HUD_CAPTION_TRACKING, HUD_FONT_DISPLAY, HUD_FONT_MONO, HUD_GLOW_ALPHA,
  HUD_GLOW_WIDE_ALPHA, HUD_GLOW_WIDE_SCALE, HUD_GRID_ALPHA, HUD_GRID_CELL,
  HUD_HUES, HUD_PALE, HUD_THEME,
} from 'Σhud/tokens'

import type { CSSProperties } from 'react'


/**
 * `HUD_HUES.cyan` becomes `--hud-hue-cyan`.
 *
 * Built by walking the table rather than spelled out, so adding an instrument
 * hue upstream needs no edit here — which is the only way a bridge like this
 * stays honest over time.
 */
const fromTable = (table: Record<string, string>, prefix: string) =>
  Object.fromEntries(Object.entries(table).map(([ name, value ]) => [ `${prefix}${name}`, value ]))

/**
 * Spread onto the root of a HUD-dressed surface.
 *
 * Cast once, here: custom properties are not part of `CSSProperties`, and doing
 * it at the boundary means no consumer has to repeat the cast.
 *
 * `--hud-font-display` is a `font` SHORTHAND (it carries weight and size), so a
 * rule using it must set `font-size` on the line after — the shorthand resets
 * it. `--hud-font-mono` is a plain family list and goes in `font-family`.
 */
export const hudThemeVars = {
  ...fromTable(HUD_HUES, '--hud-hue-'),
  ...fromTable(HUD_PALE, '--hud-pale-'),

  '--hud-primary':   HUD_THEME.primary,
  '--hud-bright':    HUD_THEME.bright,
  '--hud-wash':      HUD_THEME.pale,
  '--hud-dim':       HUD_THEME.dim,
  '--hud-dimmer':    HUD_THEME.dimmer,
  '--hud-accent':    HUD_THEME.accent,
  '--hud-red':       HUD_THEME.red,
  '--hud-green':     HUD_THEME.green,
  '--hud-ink':       HUD_THEME.ink,
  '--hud-ink-solid': HUD_THEME.inkSolid,

  '--hud-font-display': HUD_FONT_DISPLAY,
  '--hud-font-mono':    HUD_FONT_MONO,

  '--hud-bracket-len':      `${HUD_BRACKET_LEN}px`,
  '--hud-bracket-inset':    `${HUD_BRACKET_INSET}px`,
  '--hud-caption-size':     `${HUD_CAPTION_SIZE}px`,
  '--hud-caption-tracking': `${HUD_CAPTION_TRACKING}px`,
  '--hud-grid-cell':        `${HUD_GRID_CELL}px`,

  '--hud-grid-alpha':      String(HUD_GRID_ALPHA),
  '--hud-glow-wide-scale': String(HUD_GLOW_WIDE_SCALE),
  '--hud-glow-wide-alpha': String(HUD_GLOW_WIDE_ALPHA),
  '--hud-glow-alpha':      String(HUD_GLOW_ALPHA),
  '--hud-bar-segments':    String(HUD_BAR_SEGMENTS),
} as CSSProperties
