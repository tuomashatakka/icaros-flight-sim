'use client'

import Link from 'next/link'
import styles from './hud.module.css'


export function BackToMenu () {
  return <Link className={ styles.backToMenu } href="/">‹ Menu</Link>
}
