'use client'

import { useEffect } from 'react'
import { useBattleStore } from '@/hooks/use-battle-store'
import { TEAM_COLORS } from '@/engine/battle/arena'
import styles from './battle-ui.module.css'


function formatTime (s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

export function BattleUI () {
  const status    = useBattleStore(s => s.status)
  const error     = useBattleStore(s => s.error)
  const countdown = useBattleStore(s => s.countdown)
  const timeLeft  = useBattleStore(s => s.timeLeft)
  const scores    = useBattleStore(s => s.scores)
  const roster    = useBattleStore(s => s.roster)
  const zones     = useBattleStore(s => s.zones)
  const flags     = useBattleStore(s => s.flags)
  const toasts    = useBattleStore(s => s.toasts)
  const clear     = useBattleStore(s => s.clearToast)
  const myTeam    = useBattleStore(s => s.myTeam)
  const myHealth  = useBattleStore(s => s.myHealth)
  const maxHealth = useBattleStore(s => s.maxHealth)
  const lockOn    = useBattleStore(s => s.lockOn)

  useEffect(() => {
    if (toasts.length === 0)
      return

    const timers = toasts.map(t =>
      setTimeout(() => clear(t), 3200)
    )
    return () => timers.forEach(clearTimeout)
  }, [ toasts, clear ])

  const live  = status === 'live' || status === 'countdown'
  const hpPct = Math.max(0, Math.min(100, Math.round(myHealth / (maxHealth || 100) * 100)))

  return <div className={ styles.hud }>
    {status === 'error' &&
        <div className={ styles.error } data-test="battle-error">
          {error ?? 'connection lost'}
        </div>
    }

    {/* Scoreboard */}
    <div className={ styles.scoreboard }>
      <div className={ [ styles.team, myTeam === 'red' ? styles.isYou : '' ].join(' ') }>
        <span className={ [ styles.dot, styles.red ].join(' ') } />
        <span className={ styles.teamName }>RED</span>
        <span className={ styles.score }>{scores.red}</span>
      </div>

      <div className={ styles.scoreboardDivider }>·</div>

      <div className={ [ styles.team, myTeam === 'blue' ? styles.isYou : '' ].join(' ') }>
        <span className={ [ styles.dot, styles.blue ].join(' ') } />
        <span className={ styles.teamName }>BLUE</span>
        <span className={ styles.score }>{scores.blue}</span>
      </div>
    </div>

    {/* Health Bar */}
    {live &&
        <div className={ styles.healthContainer }>
          <div className={ styles.healthHeader }>
            <span className={ styles.healthLabel }>HULL SHIELD</span>
            <span className={ styles.healthValue }>{myHealth} HP</span>
          </div>

          <div className={ styles.healthBar }>
            <div
              className={ [
                styles.healthFill,
                hpPct < 35 ? styles.criticalHp : hpPct < 60 ? styles.warnHp : styles.fullHp,
              ].join(' ') }
              style={{ width: `${hpPct}%` }} />
          </div>
        </div>
    }

    {/* Crosshair & Lock-on Reticle */}
    {live &&
        <div className={ [ styles.crosshair, lockOn.active ? styles.isLocked : '' ].join(' ') }>
          <div className={ styles.centerDot } />
          <div className={ styles.reticleRing } />
          <div className={ [ styles.reticleBracket, styles.bracketTopLeft ].join(' ') } />
          <div className={ [ styles.reticleBracket, styles.bracketTopRight ].join(' ') } />
          <div className={ [ styles.reticleBracket, styles.bracketBottomLeft ].join(' ') } />
          <div className={ [ styles.reticleBracket, styles.bracketBottomRight ].join(' ') } />

          {lockOn.active && lockOn.name &&
            <div
              className={ styles.lockBadge }
              style={{ color: lockOn.team ? TEAM_COLORS[lockOn.team] : '#22d3ee' }}>
              <span className={ styles.lockIcon }>✦ LOCK-ON</span>
              <span className={ styles.lockTarget }>{lockOn.name.toUpperCase()} ({lockOn.distance}m)</span>
            </div>
          }
        </div>
    }

    {/* Status readout */}
    <div className={ styles.status }>
      {status === 'queued' && <span>WAITING FOR MATCH…</span>}

      {status === 'countdown' &&
          <span className={ styles.countdown }>{Math.max(0, Math.ceil(countdown))}</span>
      }

      {status === 'live' && <span>⏱ {formatTime(timeLeft)}</span>}
      {status === 'finished' && <span>MATCH OVER</span>}
    </div>

    {/* Control zones */}
    {live && zones.length > 0 &&
        <div className={ styles.zones }>
          {zones.map(z =>
            <div
              key={ z.id }
              className={ styles.zone }
              data-owner={ z.owner ?? 'neutral' }>
              <span className={ styles.zoneName }>{z.id.toUpperCase()}</span>

              <div className={ styles.zoneBar }>
                <div
                  className={ styles.zoneFill }
                  style={{
                    width:      `${Math.round(z.progress * 100)}%`,
                    background: z.owner ? TEAM_COLORS[z.owner] : 'var(--accent)',
                  }} />
              </div>
            </div>
          )}
        </div>
    }

    {/* Flag state */}
    <div className={ styles.flags }>
      {flags.map(f =>
        <span key={ f.team } className={ [ styles.flag, styles[f.team] ].join(' ') }>
          {f.state === 'carried' ? '◈ carrying' : f.state === 'dropped' ? '✕ dropped' : '■ home'}
        </span>
      )}
    </div>

    {/* Roster (visible during queue/countdown for team sizing) */}
    {!live && roster.length > 0 &&
        <div className={ styles.roster }>
          {[ 'red', 'blue' ].map(team =>
            <div key={ team } className={ styles.rosterColumn }>
              <span className={ [ styles.rosterTitle, styles[team] ].join(' ') }>{team.toUpperCase()}</span>

              <ul className={ styles.rosterList }>
                {roster.filter(p => p.team === team).map(p =>
                  <li key={ p.id } className={ styles.rosterName }>
                    {p.name}
                    {p.isBot ? <em className={ styles.botTag }> · bot</em> : null}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
    }

    {/* Event toasts */}
    <div className={ styles.toasts }>
      {toasts.map(t => {
        const key  = t.split('|')[0]
        const text = t.split('|').slice(1)
          .join('|')
        return <button key={ key } className={ styles.toast } onClick={ () => clear(t) }>
          {text}
        </button>
      })}
    </div>

    {/* Controls help */}
    <footer className={ styles.footer }>
      W/S: Throttle/Rev · A/D: Turn · Q/E: Strafe · SPACE/F: Bolt · SHIFT: Boost · R: Respawn
    </footer>
  </div>
}
