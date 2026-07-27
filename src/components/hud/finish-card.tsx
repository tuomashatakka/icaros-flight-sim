'use client'

import { useRaceStore, formatTime } from '@/hooks/use-race-store'
import styles from './hud.module.css'

/** End-of-race summary. The one DOM surface that still needs the race clocks. */
export function FinishCard () {
  const status    = useRaceStore(s => s.status)
  const elapsed   = useRaceStore(s => s.elapsed)
  const bestLap   = useRaceStore(s => s.bestLap)
  const lapTimes  = useRaceStore(s => s.lapTimes)
  const resetRace = useRaceStore(s => s.resetRace)

  if (status !== 'finished')
    return null

  return <div className={ styles.finishScrim }>
    <section className={ styles.finishCard }>
      <h2 className={ styles.finishTitle }>FINISH</h2>

      <p className={ styles.finishTotal }>
        Total:
        {' '}
        <span className={ styles.tabular }>{ formatTime(elapsed) }</span>
      </p>

      <p className={ styles.finishBest }>
        Best lap:
        {' '}

        <span className={ styles.tabular }>
          { bestLap === null ? '--' : formatTime(bestLap) }
        </span>
      </p>

      { lapTimes.length > 1 &&
        <ul className={ styles.lapList }>
          { lapTimes.map((t, i) =>
            <li key={ i }>
              Lap
              {' '}
              { i + 1 }
              :
              {' '}
              <span className={ styles.tabular }>{ formatTime(t) }</span>
            </li>
          ) }
        </ul> }

      <button className={ styles.raceAgain } onClick={ resetRace }>Race Again</button>
    </section>
  </div>
}
