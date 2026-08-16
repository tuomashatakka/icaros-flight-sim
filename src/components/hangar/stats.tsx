'use client'

import type { ShipId, ShipStats } from '@/lib/ship/registry'
import { useGaugeAnimation } from '@/hooks/use-gauge-animation'
import styles from './stats.module.css'

/**
 * Reading band for the gauges: stats are multipliers around the stock racer's
 * 1.0, so the arcs span 0.85..1.20 — a ship at 1.0 reads at mid-gauge, which is
 * honest about the scale rather than pretending "average" is a whole gauge.
 */
const STAT_MIN   = 0.85
const STAT_MAX   = 1.20
const GAUGE_PATH = 100
const SWEEP      = 900

function clamp01 (value: number): number {
  return Math.max(0, Math.min(1, value))
}

type GaugeProps = {
  label: string;
  value: number;
}

/**
 * One radial gauge.
 *
 * Both animations (arc sweep + count-up) live in `useGaugeAnimation`; the block
 * is remounted by the `shipId` key whenever a ship is selected, so each pick
 * sweeps the arcs from empty and counts the new numbers up.
 */
function Gauge ({ label, value }: GaugeProps) {
  const ratio                = clamp01((value - STAT_MIN) / (STAT_MAX - STAT_MIN))
  const display              = Math.round(value * 100)
  const finalFill            = GAUGE_PATH * (1 - ratio)
  const { arcRef, valueRef } = useGaugeAnimation(finalFill, display, SWEEP)

  return <figure className={ styles.gauge }>
    <div className={ styles.gaugeRing }>
      <svg aria-hidden viewBox="0 0 64 64">
        <circle
          className={ styles.gaugeTrack }
          cx="32"
          cy="32"
          r="26"
          pathLength={ GAUGE_PATH } />

        <circle
          ref={ arcRef }
          className={ styles.gaugeFill }
          cx="32"
          cy="32"
          r="26"
          pathLength={ GAUGE_PATH }
          strokeDasharray={ GAUGE_PATH }
          strokeDashoffset={ GAUGE_PATH } />
      </svg>

      <span ref={ valueRef } className={ styles.gaugeValue }>{ display }</span>
    </div>

    <figcaption className={ styles.gaugeLabel }>{ label }</figcaption>
  </figure>
}

const STAT_ITEMS: Array<{ label: string; key: keyof ShipStats }> = [
  { label: 'Top Speed', key: 'topSpeed' },
  { label: 'Acceleration', key: 'accel' },
  { label: 'Handling', key: 'handling' },
  { label: 'Durability', key: 'durability' },
]

/**
 * Performance gauges for the selected hull.
 *
 * Keyed by `shipId` so selecting a different ship remounts the block and both
 * the arc sweep and the count-up restart — the "animate on selection" behaviour.
 */
type ShipStatsBlockProps = { stats: ShipStats; shipId: ShipId }

export function ShipStatsBlock ({ stats, shipId }: ShipStatsBlockProps) {
  return <div key={ shipId } className={ styles.block }>
    <div className={ styles.grid }>
      { STAT_ITEMS.map(item =>
        <Gauge key={ item.key } label={ item.label } value={ stats[item.key] } />
      ) }
    </div>

    <p className={ styles.note }>
      Read 100 as the stock racer&apos;s value, ~85 to 120 across the fleet. Handling data, not
      live physics — stats describe the hull.
    </p>
  </div>
}
