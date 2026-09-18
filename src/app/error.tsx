'use client'

/**
 * The default boundary for an uncaught render error in any route.
 *
 * Next requires this to be a Client Component — it renders in place of the
 * segment that threw, on the client, so `reset()` can attempt the render
 * again without a full navigation. Before this file existed there was no
 * boundary at all here: an uncaught error fell through to Next's own default
 * page, which says nothing about this game and offers no way back into it.
 */

import { useEffect } from 'react'

import styles from './boundary.module.css'


type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error ({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // The digest is what a production log can actually look up; the message
    // is what a local dev session has instead, since prod strips it.
    console.error('[error boundary]', error.digest ?? error.message)
  }, [ error ])

  return <main className={ styles.page }>
    <section className={ styles.panel }>
      <h1 className={ styles.title }>Something broke</h1>
      <p className={ styles.message }>The screen hit a snag. It is safe to try again.</p>
      <button type="button" className={ styles.primary } onClick={ () => reset() }>Try again</button>
    </section>
  </main>
}
