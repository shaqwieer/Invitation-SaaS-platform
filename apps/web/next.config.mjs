import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the latter yields
// "/D:/…/3%20-%20Freelancer/…" — a leading slash and percent-encoded spaces —
// which Next resolves relative to the drive root and writes the standalone
// bundle into a nested duplicate of the whole project.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emits a self-contained server bundle so the production image needs neither
  // node_modules nor the monorepo around it.
  output: 'standalone',
  // @da3wa/shared is published as TypeScript source, not a built package.
  transpilePackages: ['@da3wa/shared'],
  // In Next 14 this still lives under `experimental`; at the top level it is
  // silently ignored, and the standalone bundle then misses workspace files.
  experimental: {
    outputFileTracingRoot: repoRoot,
  },
  eslint: { ignoreDuringBuilds: true },

  webpack: (config) => {
    // @da3wa/shared is ESM TypeScript: its internal imports carry the required
    // '.js' extension while the files on disk are '.ts'. Node and tsx resolve
    // that pairing natively; webpack needs to be told.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
