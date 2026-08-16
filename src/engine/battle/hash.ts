/**
 * Deterministic action hashing and verification for local physics & state.
 *
 * Each action modifying player or state (movement tick, weapon fire, hit damage,
 * zone capture, respawn) is hashed deterministically. The local simulation computes
 * the local state/action hash and verifies it against the server-provided hash.
 */

export interface ServerAction {
  tick:    number;
  type:    string;
  payload: Record<string, unknown>;
  hash:    string;
}

export interface HashVerificationResult {
  tick:       number;
  actionType: string;
  serverHash: string;
  localHash:  string;
  matched:    boolean;
}

/**
 * Fast deterministic FNV-1a hash function returning an 8-character hex string.
 */
export function fnv1a32 (str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Computes a deterministic hash for a battle action and current state.
 */
export function calculateActionHash (
  type: string,
  tick: number,
  payload: Record<string, unknown>,
  stateSnapshot: Record<string, unknown>
): string {
  const canonicalString = JSON.stringify({
    type,
    tick,
    payload,
    state: stateSnapshot,
  }, Object.keys).replace(/\s+/g, '')

  return fnv1a32(canonicalString)
}

/**
 * Verifies a server action hash against the locally computed state.
 */
export function verifyActionHash (
  serverAction: ServerAction,
  localStateSnapshot: Record<string, unknown>
): HashVerificationResult {
  const localHash = calculateActionHash(
    serverAction.type,
    serverAction.tick,
    serverAction.payload,
    localStateSnapshot
  )

  const matched = localHash === serverAction.hash

  if (!matched)
    console.warn(
      `[Battle Hash Verification Failed] Tick ${serverAction.tick} (${serverAction.type}): ` +
      `expected ${serverAction.hash}, calculated ${localHash}`
    )

  return {
    tick:       serverAction.tick,
    actionType: serverAction.type,
    serverHash: serverAction.hash,
    localHash,
    matched,
  }
}
