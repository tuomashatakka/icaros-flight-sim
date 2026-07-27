'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/hooks/use-store'
import styles from './hud.module.css'

/**
 * Brief vignette flash on a hard impact.
 *
 * Driven by a monotonic counter rather than a boolean, so two impacts in quick
 * succession retrigger it instead of the second one being swallowed while the
 * first is still showing.
 */
export function CrashFlash () {
  const crashFlash            = useStore(s => s.crashFlash)
  const [ active, setActive ] = useState(false)

  useEffect(() => {
    if (crashFlash === 0)
      return
    setActive(true)

    const id = setTimeout(() => setActive(false), 220)
    return () => clearTimeout(id)
  }, [ crashFlash ])

  return <div className={ active ? styles.crashFlashActive : styles.crashFlash } />
}
