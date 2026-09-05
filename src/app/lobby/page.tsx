'use client'

/**
 * The lobby.
 *
 * A third of what it was, because most of what it did is Colyseus's job now.
 * There is no lobby socket, no `create`/`join`/`ready`/`start` protocol, no
 * ticket table and no roster to keep in sync — `joinOrCreate(mode, { track })`
 * with a `filterBy` on the server seats everyone who picked the same thing in
 * the same room and starts a new one for anyone who picked something else.
 *
 * What is left is genuinely a lobby's job: who you are, what you want to play,
 * and who is already playing it.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { TRACK_IDS } from '@crash-velocity/race'

import { guestName, login, logout, register, rememberGuestName } from 'Δlib/net/account'
import { resolveServerUrl } from 'Δengine/net/room-link'


import styles from './lobby.module.css'


const TRACK_NAMES: Record<string, string> = {
  'flats':        'The Flats',
  'neon-canyon':  'Neon Canyon',
  'orbital-ring': 'Orbital Ring',
  'procedural':   'Procedural Sprint',
}

function Identity () {
  const { data: session, status } = useSession()
  const [ open, setOpen ]         = useState(false)
  const [ username, setUsername ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ error, setError ]       = useState<string | null>(null)
  const [ busy, setBusy ]         = useState(false)

  const submit = async (mode: 'login' | 'register') => {
    setBusy(true)
    setError(null)

    const result = await (mode === 'register' ? register : login)(username, password)
    setBusy(false)

    if (result.ok)
      setOpen(false)
    else
      setError(result.error)
  }

  if (status === 'loading')
    return <p className={ styles.identity }>
      <span>…</span>
    </p>

  if (session?.user)
    return <p className={ styles.identity }>
      <span>{ session.user.name }</span>
      <button type="button" className={ styles.button } onClick={ () => void logout() }>sign out</button>
    </p>

  if (!open)
    return <p className={ styles.identity }>
      <span>Flying as a guest</span>
      <button type="button" className={ styles.button } onClick={ () => setOpen(true) }>sign in</button>
    </p>

  return <form className={ styles.identity } onSubmit={ event => event.preventDefault() }>
    <label className={ styles.field }>
      <span>Pilot</span>

      <input
        className={ styles.input } value={ username } autoComplete="username"
        onChange={ e => setUsername(e.target.value) } />
    </label>

    <label className={ styles.field }>
      <span>Password</span>

      <input
        className={ styles.input } type="password" value={ password }
        autoComplete="current-password"
        onChange={ e => setPassword(e.target.value) } />
    </label>

    <button type="submit" className={ styles.primary } disabled={ busy } onClick={ () => void submit('login') }>sign in</button>
    <button type="button" className={ styles.button } disabled={ busy } onClick={ () => void submit('register') }>register</button>
    <button type="button" className={ styles.button } onClick={ () => setOpen(false) }>cancel</button>
    { error && <span className={ styles.error }>{ error }</span> }
  </form>
}

type LiveRoom = {
  roomId:   string;
  name:     string;
  clients:  number;
  locked:   boolean;
  metadata: Record<string, string>;
}

type LiveRooms = { race: LiveRoom[]; battle: LiveRoom[] }

/**
 * What is already running, polled rather than streamed.
 *
 * The old lobby held a socket open purely to keep this list fresh. A room list
 * changes when somebody starts a match — seconds apart, not frames — so an HTTP
 * poll is the right shape and costs nothing when the tab is idle.
 */
function useLiveRooms (server?: string): LiveRooms {
  const [ rooms, setRooms ] = useState<LiveRooms>({ race: [], battle: []})

  useEffect(() => {
    // The socket URL with an http scheme: the game server serves both from one
    // port, and this way `?sv=` overrides them together.
    const base = resolveServerUrl(server).replace(/^ws/, 'http')
    let live   = true

    const poll = async () => {
      try {
        const response = await fetch(`${base}/rooms`, { cache: 'no-store' })
        const body     = await response.json() as { rooms: LiveRoom[] }
        if (live)
          setRooms({
            race:   body.rooms.filter(r => r.name === 'race'),
            battle: body.rooms.filter(r => r.name === 'battle'),
          })
      }
      catch {
        if (live)
          setRooms({ race: [], battle: []})
      }
    }

    void poll()

    const timer = setInterval(() => void poll(), 4000)

    return () => {
      live = false
      clearInterval(timer)
    }
  }, [ server ])

  return rooms
}

function LobbyContent () {
  const params  = useSearchParams()
  const router  = useRouter()
  const server  = params.get('sv') ?? undefined
  const rooms   = useLiveRooms(server)
  const session = useSession()

  const [ name, setName ] = useState('')
  useEffect(() => setName(guestName()), [])

  const go = useCallback((path: string) => {
    if (!session.data?.user && name)
      rememberGuestName(name)

    const query = new URLSearchParams()
    if (server)
      query.set('sv', server)
    if (!session.data?.user && name)
      query.set('n', name)

    const search = query.toString()
    router.push(search ? `${path}?${search}` : path)
  }, [ router, server, name, session.data ])

  const playersOn = (list: LiveRoom[], key: string, value: string) =>
    list.filter(r => r.metadata?.[key] === value).reduce((total, r) => total + r.clients, 0)

  return <main className={ styles.page }>
    <div aria-hidden className={ styles.wash } />

    <section className={ styles.inner }>
      <header className={ styles.header }>
        <h1 className={ styles.title }>Lobby</h1>
        <Identity />
        <Link href="/" className={ styles.back }>‹ Back to menu</Link>
      </header>

      { !session.data?.user && <label className={ styles.field }>
        <span>Callsign</span>

        <input
          className={ styles.input } value={ name } maxLength={ 24 }
          placeholder="Pilot"
          onChange={ e => setName(e.target.value) } />
      </label> }

      <section className={ styles.columns }>
        <div className={ styles.panel }>
          <h2 className={ styles.panelTitle }>Race</h2>

          <ul className={ styles.matchList }>
            { TRACK_IDS.map(id => <li key={ id } className={ styles.matchRow }>
              <span className={ styles.matchName }>{ TRACK_NAMES[id] ?? id }</span>
              <span className={ styles.matchMeta }>{ playersOn(rooms.race, 'trackId', id) } on track</span>
              <button type="button" className={ styles.primary } onClick={ () => go(`/levels/${id}`) }>race</button>
            </li>) }
          </ul>
        </div>

        <div className={ styles.panel }>
          <h2 className={ styles.panelTitle }>Battle</h2>

          <ul className={ styles.matchList }>
            <li className={ styles.matchRow }>
              <span className={ styles.matchName }>Apex Basin</span>
              <span className={ styles.matchMeta }>{ playersOn(rooms.battle, 'arenaId', 'apex') } in the arena</span>
              <button type="button" className={ styles.primary } onClick={ () => go('/battle') }>fight</button>
            </li>
          </ul>

          <p className={ styles.empty }>
            Rooms fill themselves: everyone who picks the same track or arena lands in the same match.
          </p>
        </div>
      </section>
    </section>
  </main>
}

export default function LobbyPage () {
  return <Suspense fallback={ <main className={ styles.page } /> }>
    <LobbyContent />
  </Suspense>
}
