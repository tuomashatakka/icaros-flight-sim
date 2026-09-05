import type { Metadata, Viewport } from 'next'
import './globals.css'
import { PropsWithChildren } from 'react'
import Session from 'Ʊsession-provider'


export const metadata: Metadata = {
  title:       'Crash Velocity',
  description: 'A Burnout-inspired 3D racing game.',
}

/**
 * `viewportFit: 'cover'` is what makes `env(safe-area-inset-*)` mean anything.
 *
 * Without it those values resolve to 0 on every device, so the HUD's touch
 * layout had no way to know the bottom of a phone is behind a home indicator —
 * which is where it was putting the sticks. `userScalable: false` because the
 * canvas owns pinch: it is the camera zoom, not a page zoom.
 */
export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  viewportFit:  'cover',
  userScalable: false,
  themeColor:   '#0a0c14',
}

export default function RootLayout ({ children }: Readonly<PropsWithChildren>) {
  return <html lang="en">
    <body>
      <Session>{ children }</Session>
    </body>
  </html>
}
