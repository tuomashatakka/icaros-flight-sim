'use client'

import Link from 'next/link'
import { LEVELS } from '@/lib/levels'
import styles from './main-menu.module.css'


export function MainMenu () {
  return <main className={ styles.page }>
    <div aria-hidden className={ styles.glow } />
    <div aria-hidden className={ styles.grid } />

    <div className={ styles.inner }>
      <header className={ styles.header }>
        <p className={ styles.eyebrow }>Stellar Simulations</p>
        <h1 className={ styles.title }>SPACE RACE</h1>

        <p className={ styles.blurb }>
          Pick a circuit, then tune your machine in the hangar. Aftertouch arcade racing
          across procedural worlds.
        </p>
      </header>

      <section aria-labelledby="tracks-heading" className={ styles.section }>
        <h2 id="tracks-heading" className={ styles.sectionTitle }>Select a track</h2>

        <div className={ styles.cards }>
          { LEVELS.map(level =>
            <Link
              key={ level.id }
              href={ `/levels/${level.id}` }
              className={ styles.card }
              // The card gradient is per-level data, fed to one CSS rule as
              // custom properties rather than four near-identical classes.
              style={{ '--card-from': level.accent[0], '--card-to': level.accent[1] } as React.CSSProperties}>
              <span className={ styles.cardKind }>Circuit</span>
              <h3 className={ styles.cardName }>{ level.name }</h3>
              <p className={ styles.cardTagline }>{ level.tagline }</p>
              <span className={ styles.cardCta }>Race ›</span>
            </Link>
          ) }
        </div>
      </section>

      <nav className={ styles.nav }>
        <Link href="/hangar" className={ styles.hangarLink }>⚙ Enter the Hangar</Link>
        <Link href="/battle" className={ styles.battleLink }>⚔ Join a Battle</Link>
        <Link href="/editor" className={ styles.editorLink }>⌑ Open Map Forge</Link>
      </nav>
    </div>
  </main>
}
