/** @type {import('next').NextConfig} */

// Paquetes con binarios nativos (módulos de contenidos: imágenes, rótulos y
// vídeo). No se empaquetan con webpack: Node los carga de node_modules.
const NATIVE_PACKAGES = ["@napi-rs/canvas", "sharp", "ffmpeg-static"];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: NATIVE_PACKAGES,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) return config;
    const original = config.externals;
    config.externals = [
      async ({ request }) => {
        if (request && NATIVE_PACKAGES.some((p) => request === p || request.startsWith(p + "/"))) {
          return `commonjs ${request}`;
        }
        return undefined;
      },
      ...(Array.isArray(original) ? original : original ? [original] : []),
    ];
    return config;
  },
};

module.exports = nextConfig;
