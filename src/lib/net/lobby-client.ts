/**
 * The lobby socket, from the browser.
 *
 * A thin translator: sends the messages the page asks for, and pushes whatever
 * arrives into `useLobbyStore`. Kept out of the component because a WebSocket
 * that opens and closes with a React render is a WebSocket that reconnects
 * every time somebody types.
 */

import { useLobbyStore } from 'Δhooks/use-lobby-store'
import { resolveServerUrl } from 'Δengine/battle/transport'
import type { BattleTeam } from 'Δengine/battle/arena'
import type { LobbyClientMessage, LobbyMatchConfig, LobbyServerMessage } from 'Δengine/battle/protocol'


type OptionsType = { token?: string | null; name?: string; server?: string }

export class LobbyClient {
  private ws:    WebSocket | null = null
  private closed = false
  private queue: LobbyClientMessage[] = []

  connect (options: OptionsType): void {
    this.closed = false

    const store = useLobbyStore.getState()
    store.setStatus('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(`${resolveServerUrl(options.server)}/lobby`)
    }
    catch {
      store.setError('cannot reach the game server')
      return
    }

    this.ws = ws

    ws.onopen = () => {
      this.send(options.token
        ? { type: 'auth', token: options.token }
        : { type: 'auth', name: options.name })
      this.send({ type: 'list' })

      // Anything the page asked for before the socket was open.
      for (const pending of this.queue.splice(0))
        this.send(pending)
    }

    ws.onmessage = ({ data }) => {
      try {
        this.route(JSON.parse(String(data)) as LobbyServerMessage)
      }
      catch { /* a frame the client cannot parse is the server's to fix */ }
    }

    ws.onerror = () => store.setError('cannot reach the game server')
    ws.onclose = () => {
      if (this.ws !== ws)
        return
      this.ws = null
      if (!this.closed)
        useLobbyStore.getState().setError('lost the lobby connection')
    }
  }

  private route (message: LobbyServerMessage): void {
    const store = useLobbyStore.getState()

    switch (message.type) {
      case 'welcome':
        store.welcomed({
          playerId:   message.playerId,
          name:       message.name,
          registered: message.registered,
          stats:      message.stats ?? null,
        })
        return
      case 'matches':
        store.setMatches(message.matches)
        return
      case 'lobby':
        store.setLobby({
          matchId: message.matchId,
          hostId:  message.hostId,
          config:  message.config,
          players: message.players,
          live:    message.live,
        })
        return
      case 'starting':
        store.setTicket(message.ticket)
        return
      case 'chatLine':
        store.addChat(message.from, message.text)
        return
      case 'lobbyError':
        store.setError(message.message)
    }
  }

  private send (message: LobbyClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(message))
    else
      this.queue.push(message)
  }

  list (): void {
    this.send({ type: 'list' })
  }

  create (config: Partial<LobbyMatchConfig>): void {
    this.send({ type: 'create', config })
  }

  join (matchId: string): void {
    this.send({ type: 'join', matchId })
  }

  setTeam (team: BattleTeam): void {
    this.send({ type: 'setTeam', team })
  }

  ready (value: boolean): void {
    this.send({ type: 'ready', value })
  }

  start (): void {
    this.send({ type: 'start' })
  }

  leave (): void {
    this.send({ type: 'leave' })
    useLobbyStore.getState().leftMatch()
  }

  chat (text: string): void {
    this.send({ type: 'chat', text })
  }

  close (): void {
    this.closed = true
    this.ws?.close()
    this.ws = null
  }
}
