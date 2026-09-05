'use client'

/**
 * Auth.js's session context.
 *
 * A client component wrapper so the root layout can stay a server component —
 * `SessionProvider` uses context, which a server component cannot provide.
 */

import { SessionProvider } from 'next-auth/react'

import type { PropsWithChildren } from 'react'


export default function Session ({ children }: PropsWithChildren) {
  return <SessionProvider>{ children }</SessionProvider>
}
