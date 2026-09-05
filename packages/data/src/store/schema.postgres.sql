-- Battle server persistence, on Postgres.
--
-- The same four tables as `packages/server/src/store/schema.sql`, and they have
-- to stay the same: `store-contract.ts` asserts every implementation answers
-- identically, so a column that drifts here is a failing test, not a surprise
-- in production.
--
-- Deliberately small: accounts so a returning player keeps a name and a record,
-- and match history so those records mean something. Nothing here is required
-- to play — a guest joins with no row in any of these tables.
--
-- NOTE: `migrate.ts` splits this file on `;` because Neon's HTTP endpoint
-- refuses multi-statement SQL. Keep semicolons out of string literals here, and
-- keep every statement `IF NOT EXISTS` so re-running is a no-op.

CREATE TABLE IF NOT EXISTS accounts (
  -- `text`, not `uuid`: every implementation has to round-trip the exact string
  -- `crypto.randomUUID()` produced, and `uuid` normalises casing.
  id            text   PRIMARY KEY,
  username      text   NOT NULL,
  password_hash text   NOT NULL,

  -- Epoch milliseconds, not `timestamptz`. The `Store` contract is `number` and
  -- every caller compares against `Date.now()`; a timestamp column would buy
  -- nothing and cost a conversion at each edge.
  created_at    bigint NOT NULL
);

-- Case-insensitive, so `Pilot` and `pilot` cannot both be registered and then
-- be confused for one another in a roster. It is also what makes an untargeted
-- `ON CONFLICT DO NOTHING` in `createAccount` mean "that name is taken".
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username ON accounts (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token      text   PRIMARY KEY,
  account_id text   NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS matches (
  id         text   PRIMARY KEY,
  mode       text   NOT NULL,
  arena      text   NOT NULL,
  started_at bigint NOT NULL,
  ended_at   bigint,
  winner     text,
  scores     jsonb  NOT NULL
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id   text    NOT NULL REFERENCES matches (id) ON DELETE CASCADE,

  -- Null for guests and bots. They still get a row, so a match's roster is
  -- complete even when most of it was never signed in.
  account_id text    REFERENCES accounts (id) ON DELETE SET NULL,

  name       text    NOT NULL,
  team       text    NOT NULL,
  kills      integer NOT NULL DEFAULT 0,
  deaths     integer NOT NULL DEFAULT 0,
  captures   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, name)
);

CREATE INDEX IF NOT EXISTS match_players_account ON match_players (account_id);
