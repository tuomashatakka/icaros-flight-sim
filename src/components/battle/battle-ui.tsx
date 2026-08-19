'use client'

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useBattleStore } from '@/hooks/use-battle-store'
import type { BattleZoneView } from '@/hooks/use-battle-store'
import { TEAM_COLORS } from '@/engine/battle/arena'
import type { BattleTeam } from '@/engine/battle/arena'
import { WEAPONS } from '@/engine/battle/weapons'
import type { WeaponId } from '@/engine/battle/weapons'
import { TouchControls } from '@/components/hud/touch-controls'
import styles from './battle-ui.module.css'


function formatTime (s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/** Zone pip: one square per control point, filled by whoever holds it. */
type ZonePipProps = { zone: BattleZoneView }

function ZonePip ({ zone }: ZonePipProps) {
  const held = zone.owner
  const tint = held ? TEAM_COLORS[held] : zone.capturing ? TEAM_COLORS[zone.capturing] : undefined

  return <div
    className={ cx(styles.pip, zone.contested && styles.pipContested) }
    title={ zone.name }>
    <div className={ styles.pipBody } style={ tint ? { borderColor: tint } : undefined }>
      <div
        className={ styles.pipFill }
        style={{ height: `${Math.round(zone.progress * 100)}%`, background: tint ?? 'var(--muted-foreground)' }} />

      <span className={ styles.pipGlyph }>{ zone.short }</span>
    </div>

    <span className={ styles.pipName }>{ zone.name }</span>
  </div>
}

type WeaponChipProps = {
  slot:    string;
  keyHint: string;
  id:      WeaponId;

  /** 1 = just fired, 0 = ready. */
  cooldown: number;
  ready:    boolean;
  blocked:  boolean;
}

function WeaponChip ({ slot, keyHint, id, cooldown, ready, blocked }: WeaponChipProps) {
  const spec = WEAPONS[id]
  return <div className={ cx(styles.weapon, ready && styles.weaponReady, blocked && styles.weaponBlocked) }>
    <div className={ styles.weaponHead }>
      <span className={ styles.weaponSlot }>{ slot }</span>
      <kbd className={ styles.key }>{ keyHint }</kbd>
    </div>

    <span className={ styles.weaponName } style={{ color: spec.color }}>{ spec.label }</span>

    <div className={ styles.weaponBar }>
      <div
        className={ styles.weaponCharge }
        style={{ width: `${Math.round((1 - cooldown) * 100)}%`, background: spec.color }} />
    </div>

    <span className={ styles.weaponNote }>
      { blocked ? 'NEEDS LOCK' : spec.kind === 'beam' ? `${spec.damage} dmg · beam` : `${spec.damage} dmg · guided` }
    </span>
  </div>
}

export function BattleUI () {
  const status      = useBattleStore(s => s.status)
  const error       = useBattleStore(s => s.error)
  const countdown   = useBattleStore(s => s.countdown)
  const timeLeft    = useBattleStore(s => s.timeLeft)
  const scores      = useBattleStore(s => s.scores)
  const scoreTarget = useBattleStore(s => s.scoreTarget)
  const roster      = useBattleStore(s => s.roster)
  const zones       = useBattleStore(s => s.zones)
  const flags       = useBattleStore(s => s.flags)
  const toasts      = useBattleStore(s => s.toasts)
  const killFeed    = useBattleStore(s => s.killFeed)
  const clear       = useBattleStore(s => s.clearToast)
  const aimPitch    = useBattleStore(s => s.aimPitch)
  const myTeam      = useBattleStore(s => s.myTeam)
  const myHealth    = useBattleStore(s => s.myHealth)
  const maxHealth   = useBattleStore(s => s.maxHealth)
  const myBoost     = useBattleStore(s => s.myBoost)
  const myKills     = useBattleStore(s => s.myKills)
  const myDeaths    = useBattleStore(s => s.myDeaths)
  const carrying    = useBattleStore(s => s.carrying)
  const lockOn      = useBattleStore(s => s.lockOn)
  const primary     = useBattleStore(s => s.primary)
  const secondary   = useBattleStore(s => s.secondary)

  useEffect(() => {
    if (toasts.length === 0)
      return

    const timers = toasts.map(t => setTimeout(() => clear(t), 3200))
    return () => timers.forEach(clearTimeout)
  }, [ toasts, clear ])

  const live       = status === 'live' || status === 'countdown'
  const hpPct      = Math.max(0, Math.min(100, Math.round(myHealth / (maxHealth || 100) * 100)))
  const critical   = hpPct < 30
  const locked     = lockOn.phase === 'locked'
  const tracking   = lockOn.phase === 'tracking'
  const lockPct    = Math.round(lockOn.progress * 100)
  const secBlocked = Boolean(secondary?.needsLock) && !locked

  const teamScore = (team: BattleTeam) => Math.min(100, Math.round(scores[team] / (scoreTarget || 1) * 100))

  return <div className={ cx(styles.hud, critical && live && styles.hudCritical) }>
    { status === 'error' &&
      <div className={ styles.error } data-test="battle-error">{ error ?? 'connection lost' }</div> }

    {/* ── top bar: score, clock, control points ─────────────────── */}
    <header className={ styles.topBar }>
      <div className={ cx(styles.teamBlock, myTeam === 'red' && styles.isYou) }>
        <span className={ styles.teamTag } data-team="red">RED</span>
        <span className={ styles.teamScore }>{ scores.red }</span>
      </div>

      <div className={ styles.centre }>
        <div className={ styles.clock }>
          { status === 'countdown'
            ? <span className={ styles.countdown }>{ Math.max(0, Math.ceil(countdown)) }</span>
            : status === 'finished'
              ? <span className={ styles.over }>MATCH OVER</span>
              : status === 'live'
                ? formatTime(timeLeft)
                : 'STANDBY' }
        </div>

        <div className={ styles.scoreTrack }>
          <div className={ styles.scoreBarRed } style={{ width: `${teamScore('red')}%` }} />
          <div className={ styles.scoreBarBlue } style={{ width: `${teamScore('blue')}%` }} />
        </div>

        <div className={ styles.target }>FIRST TO { scoreTarget }</div>
      </div>

      <div className={ cx(styles.teamBlock, styles.teamBlockRight, myTeam === 'blue' && styles.isYou) }>
        <span className={ styles.teamScore }>{ scores.blue }</span>
        <span className={ styles.teamTag } data-team="blue">BLUE</span>
      </div>
    </header>

    { live && zones.length > 0 &&
      <div className={ styles.pips }>
        { zones.map(z => <ZonePip key={ z.id } zone={ z } />) }
      </div> }

    {/* ── reticle ───────────────────────────────────────────────── */}
    { live &&
      <div
        className={ cx(styles.reticle, tracking && styles.isTracking, locked && styles.isLocked) }
        style={{ '--aim': aimPitch } as CSSProperties}>
        <svg viewBox="0 0 120 120" className={ styles.reticleArt } aria-hidden>
          <circle className={ styles.reticleRing } cx="60" cy="60" r="34" />

          <circle
            className={ styles.reticleMeter }
            cx="60" cy="60" r="34"
            pathLength={ 100 }
            strokeDasharray={ `${lockPct} 100` } />

          <path className={ styles.reticleTick } d="M60 12v10M60 98v10M12 60h10M98 60h10" />
          <circle className={ styles.reticleDot } cx="60" cy="60" r="2.4" />
        </svg>

        <div className={ styles.lockLabel }>
          { locked
            ? <span className={ styles.lockLocked }>◆ LOCKED · { lockOn.name?.toUpperCase() } · { lockOn.distance }m</span>
            : tracking
              ? <span className={ styles.lockTracking }>ACQUIRING { lockPct }% · { lockOn.name?.toUpperCase() }</span>
              : null }
        </div>
      </div> }

    {/* ── bottom left: hull, boost, objective ───────────────────── */}
    { live &&
      <section className={ styles.pilot }>
        <div className={ styles.pilotHead }>
          <span className={ styles.pilotLabel }>HULL</span>
          <span className={ cx(styles.pilotValue, critical && styles.pilotValueCritical) }>{ myHealth }</span>

          <span className={ styles.pilotKd }>
            { myKills }
            <i>/</i>
            { myDeaths }
          </span>
        </div>

        <div className={ styles.gauge }>
          <div
            className={ cx(styles.gaugeFill, critical ? styles.hpCritical : hpPct < 60 ? styles.hpWarn : styles.hpFull) }
            style={{ width: `${hpPct}%` }} />
        </div>

        <div className={ styles.pilotHead }>
          <span className={ styles.pilotLabel }>BOOST</span>
        </div>

        <div className={ cx(styles.gauge, styles.gaugeThin) }>
          <div className={ styles.boostFill } style={{ width: `${Math.round(myBoost * 100)}%` }} />
        </div>

        { carrying &&
          <div className={ styles.carrying } style={{ color: TEAM_COLORS[carrying] }}>
            ▲ CARRYING { carrying.toUpperCase() } CORE — RUN IT HOME
          </div> }
      </section> }

    {/* ── bottom right: weapons ─────────────────────────────────── */}
    { live && primary && secondary &&
      <section className={ styles.weapons }>
        <WeaponChip
          slot="PRIMARY" keyHint="SPACE"
          id={ primary.id } cooldown={ primary.cooldown }
          ready={ primary.cooldown <= 0 } blocked={ primary.needsLock && !locked } />

        <WeaponChip
          slot="SECONDARY" keyHint="X"
          id={ secondary.id } cooldown={ secondary.cooldown }
          ready={ secondary.cooldown <= 0 && !secBlocked } blocked={ secBlocked } />
      </section> }

    {/* ── objectives ────────────────────────────────────────────── */}
    { live && flags.length > 0 &&
      <div className={ styles.cores }>
        { flags.map(f =>
          <span
            key={ f.team }
            className={ cx(styles.core, f.state !== 'home' && styles.coreAlert) }
            style={{ color: TEAM_COLORS[f.team] }}>
            <span className={ styles.coreGlyph }>▲</span>
            { f.team.toUpperCase() }
            {' '}
            { f.state === 'carried' ? 'TAKEN' : f.state === 'dropped' ? 'ADRIFT' : 'HOME' }
          </span>
        ) }
      </div> }

    {/* ── kill feed ─────────────────────────────────────────────── */}
    { killFeed.length > 0 &&
      <ul className={ styles.killFeed }>
        { killFeed.map(k =>
          <li key={ k.key } className={ styles.killRow }>
            <span style={{ color: k.team ? TEAM_COLORS[k.team] : 'var(--foreground)' }}>{ k.killer }</span>
            <span className={ styles.killWeapon }>{ k.weapon ? WEAPONS[k.weapon].label : 'RAMMED' }</span>
            <span className={ styles.killVictim }>{ k.victim }</span>
          </li>
        ) }
      </ul> }

    {/* ── scoreboard while not live ─────────────────────────────── */}
    { !live && roster.length > 0 &&
      <div className={ styles.board }>
        <h2 className={ styles.boardTitle }>{ status === 'finished' ? 'FINAL' : 'ROSTER' }</h2>

        <div className={ styles.boardCols }>
          { ([ 'red', 'blue' ] as BattleTeam[]).map(team =>
            <div key={ team } className={ styles.boardCol }>
              <span className={ styles.boardTeam } data-team={ team }>
                { team.toUpperCase() } · { scores[team] }
              </span>

              <ul className={ styles.boardList }>
                { roster.filter(p => p.team === team).map(p =>
                  <li key={ p.id } className={ styles.boardRow }>
                    <span className={ styles.boardName }>
                      { p.name }{ p.isBot ? <em className={ styles.botTag }> bot</em> : null }
                    </span>

                    <span className={ styles.boardKd }>{ p.kills }/{ p.deaths }</span>
                  </li>
                ) }
              </ul>
            </div>
          ) }
        </div>
      </div> }

    {/* ── toasts ────────────────────────────────────────────────── */}
    <div className={ styles.toasts }>
      { toasts.map(t => {
        const key  = t.split('|')[0]
        const text = t.split('|').slice(1)
          .join('|')
        return <button key={ key } className={ styles.toast } onClick={ () => clear(t) }>{ text }</button>
      }) }
    </div>

    <footer className={ styles.footer }>
      <span>
        <kbd className={ styles.key }>W/S</kbd>
        {' '}
        throttle
      </span>

      <span>
        <kbd className={ styles.key }>Q/E</kbd>
        {' '}
        turn
      </span>

      <span>
        <kbd className={ styles.key }>A/D</kbd>
        {' '}
        strafe
      </span>

      <span>
        <kbd className={ styles.key }>R/F</kbd>
        {' '}
        aim
      </span>

      <span>
        <kbd className={ styles.key }>SHIFT</kbd>
        {' '}
        boost
      </span>

      <span>
        <kbd className={ styles.key }>SPACE</kbd>
        {' '}
        beam
      </span>

      <span>
        <kbd className={ styles.key }>X</kbd>
        {' '}
        missile
      </span>

      <span>
        <kbd className={ styles.key }>C</kbd>
        {' '}
        view
      </span>

      <span>
        <kbd className={ styles.key }>⌫</kbd>
        {' '}
        respawn
      </span>
    </footer>

    { live && <TouchControls mode="battle" /> }
  </div>
}
