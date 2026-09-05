/**
 * Auth.js's own endpoints: sign in, sign out, session, csrf, providers.
 *
 * Registration is NOT here — Auth.js does not do sign-up — and lives at
 * `/api/register` rather than under `/api/auth/` so it cannot be confused for
 * one of these, or shadowed by this catch-all.
 */

import { handlers } from 'Δlib/auth'


export const runtime = 'nodejs'

export const { GET, POST } = handlers
