'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { LobbyClient } from 'Δlib/net/lobby-client'
import { login, me, register, signOut, storedName, storedToken, storeName } from 'Δlib/net/account'
import { useLobbyStore } from 'Δhooks/use-lobby-store'
import styles from './lobby.module.css'


/**
 * Auth takes no `server` override, unlike everything else on this page.
 * `?sv=` points at a battle server, and identity is not there any more — it is
 * same-origin, next to the database. The socket below still honours it.
 */
function Identity () {
  const { name, registered, stats } = useLobbyStore()
  const [ open, setOpen ]           = useState(false)
  const [ username, setUsername ]   = useState('')
  const [ password, setPassword ]   = useState('')
  const [ error, setError ]         = useState<string | null>(null)
  const [ busy, setBusy ]           = useState(false)
  const [ known, setKnown ]         = useState<{ name: string } | null>(null)

  // The socket's `welcome` says who you are too, but only once it has connected
  // and only by falling back to a guest when the token has expired. Asking
  // outright means the panel does not flicker through "guest" on every load,
  // and a week-old token is a visible sign-out rather than a silent demotion.
  useEffect(() => {
    let live = true
    void me().then(found => {
      if (!live)
        return
      if (found)
        setKnown({ name: found.account.username })
      else if (storedToken())
        signOut().catch(() => {})
    })

    return () => {
      live = false
    }
  }, [])

  const submit = async (mode: 'login' | 'register') => {
    setBusy(true)
    setError(null)

    const result = await (mode === 'register' ? register : login)(username, password)
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    // The lobby socket authenticates on connect, so the simplest correct thing
    // is to reload with the new token rather than re-authenticate in place.
    globalThis.location?.reload()
  }

  if (registered || known)
    return <p className={ styles.identity }>
      <span>{ registered ? name : known?.name }</span>
      { stats && <span>{ stats.matches } matches · { stats.kills }/{ stats.deaths } K/D</span> }

      <button
        type="button"
        className={ styles.button }
        onClick={ () => {
          void signOut().finally(() => globalThis.location?.reload())
        } }>
        sign out
      </button>
    </p>

  if (!open)
    return <p className={ styles.identity }>
      <span>playing as { name } (guest)</span>
      <button type="button" className={ styles.button } onClick={ () => setOpen(true) }>sign in</button>
    </p>

  return <form
    className={ styles.panel }
    onSubmit={ event => {
      event.preventDefault()
      void submit('login')
    } }>
    <h2 className={ styles.panelTitle }>Sign in</h2>
    { error && <p className={ styles.error }>{ error }</p> }

    <label className={ styles.field }>
      Name
      <input
        className={ styles.input }
        value={ username }
        autoComplete="username"
        onChange={ e => setUsername(e.target.value) } />
    </label>

    <label className={ styles.field }>
      Password
      <input
        className={ styles.input }
        type="password"
        value={ password }
        autoComplete="current-password"
        onChange={ e => setPassword(e.target.value) } />
    </label>

    <div className={ styles.row }>
      <button type="submit" className={ `${styles.button} ${styles.primary}` } disabled={ busy }>sign in</button>
      <button type="button" className={ styles.button } disabled={ busy } onClick={ () => void submit('register') }>create account</button>
      <button type="button" className={ styles.button } onClick={ () => setOpen(false) }>cancel</button>
    </div>
  </form>
}

type MatchesProps = { client: LobbyClient }

function Matches ({ client }: MatchesProps) {
  const { matches }         = useLobbyStore()
  const [ title, setTitle ] = useState('')

  return <section className={ styles.panel }>
    <h2 className={ styles.panelTitle }>Open matches</h2>

    { matches.length === 0
      ? <p className={ styles.empty }>Nothing running. Start one.</p>
      : <ul className={ styles.matchList }>
        { matches.map(match =>
          <li key={ match.id } className={ styles.matchRow }>
            <article>
              <h3 className={ styles.matchName }>{ match.name }</h3>

              <p className={ styles.matchMeta }>
                { match.players }/{ match.maxPlayers } · { match.mode.toUpperCase() }
                { match.live && ' · in progress' }
              </p>
            </article>

            <button type="button" className={ styles.button } onClick={ () => client.join(match.id) }>
              { match.live ? 'drop in' : 'join' }
            </button>
          </li>
        ) }
      </ul> }

    <form
      className={ styles.row }
      onSubmit={ event => {
        event.preventDefault()
        client.create({ name: title.trim() || undefined })
        setTitle('')
      } }>
      <input
        className={ styles.input }
        placeholder="New match name"
        value={ title }
        onChange={ e => setTitle(e.target.value) } />

      <button type="submit" className={ `${styles.button} ${styles.primary}` }>create</button>
    </form>
  </section>
}

type RosterProps = { client: LobbyClient }

function Roster ({ client }: RosterProps) {
  const state             = useLobbyStore()
  const [ line, setLine ] = useState('')
  const me                = state.players.find(p => p.id === state.playerId)
  const host              = state.hostId !== null && state.hostId === state.playerId

  if (!state.matchId)
    return <section className={ styles.panel }>
      <h2 className={ styles.panelTitle }>Roster</h2>
      <p className={ styles.empty }>Join or create a match to pick a side.</p>
    </section>

  return <section className={ styles.panel }>
    <h2 className={ styles.panelTitle }>{ state.config?.name ?? 'Match' }</h2>

    <ul className={ styles.roster }>
      { state.players.map(player =>
        <li key={ player.id } className={ styles.rosterRow }>
          <span className={ `${styles.team} ${player.team === 'red' ? styles.teamRed : styles.teamBlue}` } />

          <span className={ styles.rosterName }>
            { player.name }
            { player.id === state.hostId && ' ★' }
          </span>

          { player.registered && <span className={ styles.badge }>account</span> }

          <span className={ `${styles.badge} ${player.ready ? styles.ready : ''}` }>
            { player.ready ? 'ready' : 'waiting' }
          </span>
        </li>
      ) }
    </ul>

    <div className={ styles.row }>
      <button type="button" className={ styles.button } onClick={ () => client.setTeam('red') }>join red</button>
      <button type="button" className={ styles.button } onClick={ () => client.setTeam('blue') }>join blue</button>

      <button type="button" className={ styles.button } onClick={ () => client.ready(!me?.ready) }>
        { me?.ready ? 'not ready' : 'ready' }
      </button>

      <button type="button" className={ styles.button } onClick={ () => client.leave() }>leave</button>
    </div>

    <div className={ styles.row }>
      { /* Readiness is advisory: waiting on someone who wandered off is how a
           lobby of friends never plays. */ }

      <button
        type="button"
        className={ `${styles.button} ${styles.primary}` }
        disabled={ !host }
        title={ host ? undefined : 'only the host can start' }
        onClick={ () => client.start() }>
        { host ? 'launch match' : 'waiting for host' }
      </button>
    </div>

    <ul className={ styles.chat }>
      { state.chat.map(entry =>
        <li key={ entry.key }>
          <span className={ styles.chatFrom }>{ entry.from }</span>
          { entry.text }
        </li>
      ) }
    </ul>

    <form
      className={ styles.row }
      onSubmit={ event => {
        event.preventDefault()
        if (line.trim()) {
          client.chat(line.trim())
          setLine('')
        }
      } }>
      <input className={ styles.input } placeholder="Say something" value={ line } onChange={ e => setLine(e.target.value) } />
      <button type="submit" className={ styles.button }>send</button>
    </form>
  </section>
}

function LobbyContent () {
  const params    = useSearchParams()
  const router    = useRouter()
  const server    = params.get('sv') ?? undefined
  const state     = useLobbyStore()
  const clientRef = useRef<LobbyClient | null>(null)

  // One socket for the life of the page. Opening it inside a render would
  // reconnect every time somebody typed a character.
  if (!clientRef.current)
    clientRef.current = new LobbyClient()

  const client = clientRef.current

  useEffect(() => {
    client.connect({ token: storedToken(), name: storedName() ?? 'Pilot', server })
    return () => {
      client.close()
      useLobbyStore.getState().reset()
    }
  }, [ client, server ])

  // A ticket is an admission to a match that has already started, so the page's
  // job is done the moment one arrives.
  useEffect(() => {
    if (!state.ticket || !state.matchId)
      return

    storeName(state.name)

    const query = new URLSearchParams({ match: state.matchId, ticket: state.ticket, n: state.name })
    if (server)
      query.set('sv', server)

    router.push(`/battle?${query.toString()}`)
  }, [ state.ticket, state.matchId, state.name, router, server ])

  const dismiss = useCallback(() => useLobbyStore.getState().setError(null), [])

  return <main className={ styles.page }>
    <div aria-hidden className={ styles.wash } />

    <section className={ styles.inner }>
      <header className={ styles.header }>
        <h1 className={ styles.title }>Lobby</h1>
        <Identity />
        <Link href="/" className={ styles.back }>‹ Back to menu</Link>
      </header>

      { state.error && <p className={ styles.error } onClick={ dismiss }>{ state.error }</p> }
      { state.status === 'connecting' && <p className={ styles.empty }>Connecting to the game server…</p> }

      <section className={ styles.columns }>
        <Matches client={ client } />
        <Roster client={ client } />
      </section>
    </section>
  </main>
}

export default function LobbyPage () {
  return <Suspense fallback={ <main className={ styles.page } /> }>
    <LobbyContent />
  </Suspense>
}
