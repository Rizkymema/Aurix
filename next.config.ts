import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid Next.js HMR/build-indicator store loops during rapid Fast Refresh.
  devIndicators: false,
};

export default nextConfig;
