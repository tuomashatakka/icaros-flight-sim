# The game server boots as a bare `bun packages/server/src/index.ts` with no
# Procfile, fly.toml or render.yaml anywhere else in this repo to set
# NODE_ENV. `packages/server/src/config.ts` fails closed regardless (devTools
# needs an explicit COLYSEUS_DEVTOOLS=1), but this is still the one deploy
# artefact in the tree that GUARANTEES NODE_ENV=production rather than
# depending on whichever host runs the process to set it correctly.
FROM oven/bun:1.4-slim

WORKDIR /app

# Manifests first so `bun install` is its own layer, cached until a dependency
# — not a source file — changes. Every workspace's package.json has to be
# present for the root lockfile to resolve, even though only server, race,
# battle, net, physics and data run at request time.
COPY package.json bun.lock ./
COPY packages/battle/package.json packages/battle/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/data/package.json packages/data/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/game/package.json packages/game/package.json
COPY packages/net/package.json packages/net/package.json
COPY packages/physics/package.json packages/physics/package.json
COPY packages/race/package.json packages/race/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/state/package.json packages/state/package.json
COPY packages/ui/package.json packages/ui/package.json

# --production is safe here: every package the server touches at runtime
# (server, race, battle, net, data, physics) declares its runtime imports
# under "dependencies", never "devDependencies" — checked by hand rather than
# assumed. `three`, the rapier build and `@colyseus/core` are peerDependencies
# of those packages, satisfied by the root package.json's own real dependency
# on all three, which --production does not drop.
RUN bun install --frozen-lockfile --production

COPY . .

# The variable config.ts cannot default correctly on its own — nothing else in
# this repo pins it, which is the whole reason N2 existed.
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=9003
EXPOSE 9003

CMD ["bun", "packages/server/src/index.ts"]
