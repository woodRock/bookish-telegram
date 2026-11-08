import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // transformers.js only runs in the browser worker here; skip its Node-only backends.
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      "onnxruntime-node$": false,
    };
    return config;
  },
};

export default nextConfig;
