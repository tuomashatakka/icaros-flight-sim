/**
 * The default boundary for any URL that matches no route.
 *
 * A Server Component is enough here — there is nothing to react to, just a
 * message and a way back to the menu, so nothing here needs `'use client'`.
 */

import Link from 'next/link'

import styles from './boundary.module.css'


export default function NotFound () {
  return <main className={ styles.page }>
    <section className={ styles.panel }>
      <h1 className={ styles.title }>Not found</h1>
      <p className={ styles.message }>There is no track, arena or page here.</p>
      <Link href="/" className={ styles.primary }>‹ Back to menu</Link>
    </section>
  </main>
}
