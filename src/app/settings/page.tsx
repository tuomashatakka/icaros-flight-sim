'use client'

import dynamic from 'next/dynamic'


/**
 * Client-only: every value on the page comes from localStorage, which the
 * server cannot see, so a server render would only ever be the defaults —
 * and a hydration mismatch the moment a saved setting differed from them.
 */
const SettingsPage = dynamic(() => import('Ʊsettings/settings-page').then(module => module.SettingsPage), { ssr: false })

export default function Settings () {
  return <SettingsPage />
}
