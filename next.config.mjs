/** @type {import('next').NextConfig} */
const nextConfig = {
  // Both workspace packages ship TypeScript source rather than a build
  // artefact — each has one consumer here and one in `packages/server`, and
  // adding a compile step between them would only create a stale-dist failure
  // mode.
  transpilePackages: [ '@crash-velocity/physics', '@crash-velocity/data' ],
};

export default nextConfig;
