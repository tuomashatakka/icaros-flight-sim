/**
 * Route-level loading state.
 *
 * Next renders this in place of a segment that has not finished yet — mostly
 * a level or the battle route, which resolve a track/arena bundle before the
 * scene can mount. It has to stay out of the way: a hovercraft game flashing a
 * spinner between routes reads as a loading SCREEN, not a game, so this is one
 * quiet line rather than anything that asks to be looked at.
 */

import styles from './boundary.module.css'


export default function Loading () {
  return <main className={ styles.page }>
    <p className={ styles.loading }>Loading…</p>
  </main>
}
