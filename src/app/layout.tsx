import type { Metadata } from 'next'
import './globals.css'
import { PropsWithChildren } from 'react'


export const metadata: Metadata = {
  title:       'Crash Velocity',
  description: 'A Burnout-inspired 3D racing game.',
}

export default function RootLayout ({ children }: Readonly<PropsWithChildren>) {
  return <html lang="en">
    <body>
      {children}
    </body>
  </html>
}
