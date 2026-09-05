/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship TypeScript source rather than a build artefact.
  // Each has one consumer here and one in the game server, and adding a compile
  // step between them would only create a stale-dist failure mode.
  //
  // `@crash-velocity/data` is here for its types and the ticket helper; nothing
  // in a client bundle reaches its Drizzle half, which is why the route
  // handlers that do are pinned to the Node runtime.
  transpilePackages: [
    '@crash-velocity/physics',
    '@crash-velocity/net',
    '@crash-velocity/race',
    '@crash-velocity/battle',
    '@crash-velocity/data',
    '@crash-velocity/core',
    '@crash-velocity/state',
    '@crash-velocity/engine',
    '@crash-velocity/game',
    '@crash-velocity/ui',
  ],
}

export default nextConfig
