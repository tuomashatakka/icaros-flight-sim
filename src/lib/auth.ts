/**
 * Auth.js, configured for a game login.
 *
 * Two things about this setup are forced rather than chosen:
 *
 * 1. **JWT sessions, not database sessions.** Auth.js's Credentials provider
 *    cannot use the database strategy — it has no way to know a credential is
 *    still valid on a later request, so it refuses. The adapter is still here,
 *    and still owns `users`, because it is what a future OAuth provider would
 *    write through and because sign-up has to land somewhere real.
 * 2. **The game server never sees this session.** It is a different origin, so
 *    the httpOnly cookie does not reach it. `/api/game/ticket` mints a
 *    sixty-second ticket instead; see `@crash-velocity/data`'s `auth/ticket`.
 *
 * Hashing stays in `@crash-velocity/data` — Auth.js deliberately has no opinion
 * about how a password is stored, and that scrypt implementation already runs
 * identically on Vercel's Node runtime and under Bun.
 */

import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { authenticatePilot, oauthAccounts, sessions, users, verificationTokens } from '@crash-velocity/data'

import { serverDb } from 'Δlib/server/db'


export const { handlers, signIn, signOut, auth } = NextAuth(async () => {
  const db = await serverDb()

  return {
    adapter: DrizzleAdapter(db, {
      usersTable:              users,
      accountsTable:           oauthAccounts,
      sessionsTable:           sessions,
      verificationTokensTable: verificationTokens,
    }),

    session: { strategy: 'jwt' },

    // scrypt is not available on the edge runtime, and neither is the Neon
    // WebSocket driver; every handler this config reaches runs on Node.
    trustHost: true,

    providers: [
      Credentials({
        name:        'Pilot',
        credentials: { username: {}, password: {}},

        async authorize (raw) {
          const username = typeof raw?.username === 'string' ? raw.username : ''
          const password = typeof raw?.password === 'string' ? raw.password : ''

          const result = await authenticatePilot(db, username, password)
          if (!result.ok)
            return null

          return { id: result.pilot.id, name: result.pilot.username }
        },
      }),
    ],

    callbacks: {
      // The token is the only thing that survives to the ticket route, so the
      // pilot id has to ride on it explicitly — `sub` is the id Auth.js chose,
      // which for the Credentials provider is the one `authorize` returned.
      jwt ({ token, user }) {
        if (user?.id)
          token.sub = user.id
        return token
      },

      session ({ session, token }) {
        if (token.sub)
          session.user.id = token.sub
        return session
      },
    },
  }
})
