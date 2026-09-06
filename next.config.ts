import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // viem and the x402 packages are plain Node modules; keep them external to the server bundle.
  serverExternalPackages: ["@x402/fetch", "@x402/evm", "@x402/core", "viem"],
};

export default nextConfig;
