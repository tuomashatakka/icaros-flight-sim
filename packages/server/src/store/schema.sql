-- Battle server persistence.
--
-- Deliberately small: accounts so a returning player keeps a name and a record,
-- and match history so those records mean something. Nothing here is required
-- to play — a guest joins with no row in any of these tables.

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Case-insensitive, so `Pilot` and `pilot` cannot both be registered and then
-- be confused for one another in a roster.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username ON accounts (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS matches (
  id         TEXT PRIMARY KEY,
  mode       TEXT NOT NULL,
  arena      TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  winner     TEXT,
  scores     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id   TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,

  -- Null for guests and bots. They still get a row, so a match's roster is
  -- complete even when most of it was never signed in.
  account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,

  name       TEXT NOT NULL,
  team       TEXT NOT NULL,
  kills      INTEGER NOT NULL DEFAULT 0,
  deaths     INTEGER NOT NULL DEFAULT 0,
  captures   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, name)
);

CREATE INDEX IF NOT EXISTS match_players_account ON match_players (account_id);
