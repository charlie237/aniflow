/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    }
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/.data/**",
          "**/data/*.sqlite",
          "**/data/*.sqlite-*"
        ]
      };
    }
    return config;
  }
};

export default nextConfig;
