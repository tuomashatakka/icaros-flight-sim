/** @type {import('next').NextConfig} */
const nextConfig = {
  // The physics package ships TypeScript source rather than a build artefact —
  // it has one consumer in this repo and one in `packages/server`, and adding a
  // compile step between them would only create a stale-dist failure mode.
  transpilePackages: [ '@crash-velocity/physics' ],
};

export default nextConfig;
