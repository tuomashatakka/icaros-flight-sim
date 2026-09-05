/**
 * Getting a ticket for the game server.
 *
 * Auth.js's session cookie is httpOnly and same-origin, and the game server is
 * neither — so the browser asks its own backend, which CAN read the session,
 * for sixty seconds' worth of signed claim to hand over instead.
 *
 * A failure here is not fatal. Guests are first class: if the ticket route is
 * unreachable the socket opens without one and the server seats a guest, which
 * is what a signed-out visitor would have got anyway.
 */

export type TicketResponse = {
  ticket:     string;
  name:       string;
  registered: boolean;
}

export async function fetchTicket (name?: string): Promise<TicketResponse | null> {
  try {
    const query    = name ? `?name=${encodeURIComponent(name)}` : ''
    const response = await fetch(`/api/game/ticket${query}`, { cache: 'no-store' })
    return response.ok ? await response.json() as TicketResponse : null
  }
  catch {
    return null
  }
}
