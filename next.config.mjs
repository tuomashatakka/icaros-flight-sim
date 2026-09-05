/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship TypeScript source, imported through the glyph
  // aliases in tsconfig.json (Σ engine, Ɠ game, Ʊ ui, …), so Next compiles them
  // as project code; this list keeps that explicit for the tooling that reads
  // it. `@crash-velocity/data` is reached only by the Node-runtime route
  // handlers; nothing in a client bundle touches its Drizzle half.
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
