'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/hooks/use-store'
import { useRaceStore, formatTime } from '@/hooks/use-race-store'
import { TuningPanel } from '@/components/tuning-panel'
import styles from './hud.module.css'


function BackToMenu () {
  return <Link href="/" className={ styles.backToMenu }>‹ Menu</Link>
}

function SpeedGauge () {
  const speed           = useStore(state => state.speed)
  const zone            = useStore(state => state.zone)
  const speedLevels     = useStore(state => state.speedLevels)
  const maxSpeedForZone = 25 * (zone + 2)
  const speedPercentage = Math.min(speed / maxSpeedForZone * 100, 100)
  const speedKmph       = (speed * 3.6).toFixed(0)

  const visibleLevels = useMemo(() => {
    const currentLevelIndex = speedLevels.findIndex(level => level.zone === zone)
    if (currentLevelIndex === -1)
      return []

    const start = Math.max(0, currentLevelIndex - 2)
    const end   = Math.min(speedLevels.length, currentLevelIndex + 4)
    return speedLevels.slice(start, end).map((level, index) => ({
      ...level,
      // position is from -2 (top) to 3 (bottom), 0 is the center
      position: start + index - currentLevelIndex,
    }))
  }, [ zone, speedLevels ])

  return <div className={ styles.gauge }>
    <div className={ styles.gaugeTrack }>
      <div className={ styles.gaugeTrackBar }>
        <div className={ styles.gaugeTrackFill } style={{ height: `${speedPercentage}%` }} />
      </div>
    </div>

    <div className={ styles.gaugeBody }>
      <div className={ styles.gaugeMarker } />
      <div className={ styles.gaugeCaret } />
      <span className={ styles.gaugeSpeed }>{ speedKmph } km/h</span>

      <div
        className={ styles.gaugeScale }
        style={{ transform: `translateY(-${speed / maxSpeedForZone * 25}%)` }}>
        { visibleLevels.map(level =>
          <div
            key={ level.zone }
            className={ level.zone === zone ? styles.gaugeZoneActive : styles.gaugeZone }
            style={{ top: `calc(50% + ${level.position * 25}% - 12px)` }}>
            ZONE { level.zone }
          </div>
        ) }
      </div>
    </div>
  </div>
}

function TakedownCounter () {
  const takedowns = useStore(state => state.takedowns)
  return <div className={ styles.takedowns }>Takedowns: { takedowns }</div>
}

function Minimap () {
  return <div className={ styles.minimap }>
    <div className={ styles.minimapDot } title="Player" />
    <p className={ styles.minimapLabel }>Minimap</p>
  </div>
}

function Controls () {
  return <div className={ styles.controls }>
    <p>W / Up: Thrust</p>
    <p>S / Down: Brake</p>
    <p>A,D / Left,Right: Steer</p>
    <p>Shift: Boost</p>
    <p>R: Respawn</p>
  </div>
}

/** Lap/timer readout, the 3-2-1 countdown, and the finish summary. */
function RaceHud () {
  const status     = useRaceStore(s => s.status)
  const countdown  = useRaceStore(s => s.countdown)
  const currentLap = useRaceStore(s => s.currentLap)
  const laps       = useRaceStore(s => s.laps)
  const loop       = useRaceStore(s => s.loop)
  const lapElapsed = useRaceStore(s => s.lapElapsed)
  const elapsed    = useRaceStore(s => s.elapsed)
  const bestLap    = useRaceStore(s => s.bestLap)
  const lapTimes   = useRaceStore(s => s.lapTimes)
  const resetRace  = useRaceStore(s => s.resetRace)

  return <>
    <div className={ styles.raceBar }>
      <div className={ styles.stat }>
        <div className={ styles.statLabel }>{ loop ? 'LAP' : 'RUN' }</div>

        <div className={ styles.statValueAccent }>
          { loop ? `${Math.min(currentLap, laps)}/${laps}` : 'SPRINT' }
        </div>
      </div>

      <div className={ styles.stat }>
        <div className={ styles.statLabel }>TIME</div>
        <div className={ styles.statValue }>{ formatTime(elapsed) }</div>
      </div>

      <div className={ styles.stat }>
        <div className={ styles.statLabel }>LAP</div>
        <div className={ styles.statValueAccent }>{ formatTime(lapElapsed) }</div>
      </div>

      <div className={ styles.stat }>
        <div className={ styles.statLabel }>BEST</div>

        <div className={ styles.statValue }>
          { bestLap === null ? '--:--' : formatTime(bestLap) }
        </div>
      </div>
    </div>

    { status === 'countdown' &&
      <div className={ styles.centreOverlay }>
        <span className={ styles.countdown }>{ Math.ceil(countdown) }</span>
      </div> }

    { status === 'racing' && elapsed < 1 &&
      <div className={ styles.centreOverlay }>
        <span className={ styles.go }>GO!</span>
      </div> }

    { status === 'finished' &&
      <div className={ styles.finishScrim }>
        <div className={ styles.finishCard }>
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

          <button onClick={ resetRace } className={ styles.raceAgain }>Race Again</button>
        </div>
      </div> }
  </>
}

/** Boost reserve bar. */
function BoostMeter () {
  const boost = useStore(s => s.boostMeter)
  return <div className={ styles.boost }>
    <div className={ styles.boostTrack }>
      <div className={ styles.boostFill } style={{ width: `${boost * 100}%` }} />
    </div>

    <p className={ styles.boostLabel }>BOOST · hold Shift</p>
  </div>
}

/** Brief red flash on a hard impact. */
function CrashFlash () {
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

export function GameUI () {
  return <>
    <TuningPanel />
    <BackToMenu />
    <RaceHud />
    <TakedownCounter />
    <SpeedGauge />
    <Minimap />
    <BoostMeter />
    <CrashFlash />
    <Controls />
  </>
}
