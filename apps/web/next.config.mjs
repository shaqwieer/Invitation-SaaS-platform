/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emits a self-contained server bundle so the production image needs neither
  // node_modules nor the monorepo around it.
  output: 'standalone',
  // @da3wa/shared is published as TypeScript source, not a built package.
  transpilePackages: ['@da3wa/shared'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
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
