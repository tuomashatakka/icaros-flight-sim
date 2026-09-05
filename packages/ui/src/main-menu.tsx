'use client'

import Link from 'next/link'
import { LEVELS } from 'Ȼlevels'
import { hudThemeVars } from './hud-theme'
import chrome from './hud-chrome.module.css'
import styles from './main-menu.module.css'


/**
 * The four routes off the menu, as data.
 *
 * They used to be four near-identical `<Link>`s backed by four near-identical
 * CSS classes differing only in hue — including one that reached past the
 * palette for a raw `hsl()`. One table and one rule is what the track cards
 * already do with `--card-from`, and it is the only shape that keeps a new
 * destination from adding another twelve lines of CSS.
 */
const DESTINATIONS = [
  { href: '/hangar', glyph: '⚙', label: 'Enter the Hangar', kind: 'outfit', hue: 'var(--hud-hue-cyan)' },
  { href: '/lobby', glyph: '⚔', label: 'Join a Battle', kind: 'combat', hue: 'var(--hud-hue-magenta)' },
  { href: '/editor', glyph: '⌑', label: 'Open Map Forge', kind: 'authoring', hue: 'var(--hud-hue-violet)' },

  // The crash lab is a diagnostic, not a game mode, and amber is the palette's
  // "not your own systems" lane — so it reads as one next to the three that are.
  { href: '/crash-lab', glyph: '◈', label: 'Run the Crash Lab', kind: 'diagnostic', hue: 'var(--hud-hue-amber)' },
]

export function MainMenu () {
  return <main className={ styles.page } style={ hudThemeVars }>
    <div aria-hidden className={ styles.glow } />
    <div aria-hidden className={ `${chrome.grid} ${styles.backdropGrid}` } />

    <div className={ styles.inner }>
      <header className={ `${styles.header} ${chrome.bracketed}` }>
        <p className={ `${styles.eyebrow} ${chrome.caption} ${chrome.glow}` }>Stellar Simulations</p>
        <h1 className={ `${styles.title} ${chrome.glow}` }>SPACE RACE</h1>

        <p className={ `${styles.blurb} ${chrome.mono}` }>
          Pick a circuit, then tune your machine in the hangar. Aftertouch arcade racing
          across procedural worlds.
        </p>
      </header>

      <section aria-labelledby="tracks-heading" className={ styles.section }>
        <h2 id="tracks-heading" className={ `${styles.sectionTitle} ${chrome.caption}` }>Select a track</h2>

        <div className={ styles.cards }>
          { LEVELS.map(level =>
            <Link
              key={ level.id }
              href={ `/levels/${level.id}` }
              className={ `${styles.card} ${chrome.glass} ${chrome.bracketed} ${chrome.scan}` }
              // The card's own accent is per-level data, fed to one CSS rule as
              // custom properties rather than four near-identical classes. It
              // now drives the RIM and the caption rather than filling the card:
              // a HUD panel is glass with a lit edge, never a block of colour.
              style={{
                '--card-from':     level.accent[0],
                '--card-to':       level.accent[1],
                '--bracket-color': level.accent[0],
                '--glow-color':    level.accent[0],
              } as React.CSSProperties}>
              <span aria-hidden className={ `${chrome.grid} ${styles.cardGrid}` } />
              <span className={ `${styles.cardKind} ${chrome.caption}` }>Circuit</span>
              <h3 className={ styles.cardName }>{ level.name }</h3>
              <p className={ `${styles.cardTagline} ${chrome.mono}` }>{ level.tagline }</p>
              <span className={ `${styles.cardCta} ${chrome.caption}` }>Race ›</span>
              <span aria-hidden className={ `${styles.cardRail} ${chrome.segments}` } />
            </Link>
          ) }
        </div>
      </section>

      <nav className={ styles.nav }>
        { DESTINATIONS.map(destination =>
          <Link
            key={ destination.href }
            href={ destination.href }
            className={ `${styles.navLink} ${chrome.glass} ${chrome.bracketed}` }
            style={{
              '--bracket-color': destination.hue,
              '--segment-color': destination.hue,
              '--glow-color':    destination.hue,
            } as React.CSSProperties}>
            <span aria-hidden className={ styles.navGlyph }>{ destination.glyph }</span>

            <span className={ styles.navBody }>
              <span className={ `${styles.navKind} ${chrome.caption}` }>{ destination.kind }</span>
              <span className={ `${styles.navLabel} ${chrome.caption}` }>{ destination.label }</span>
            </span>

            <span aria-hidden className={ `${styles.navRail} ${chrome.segments}` } />
          </Link>
        ) }
      </nav>
    </div>
  </main>
}
