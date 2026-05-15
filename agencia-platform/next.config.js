/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    output: 'standalone',
    // Paquetes con binarios nativos (.node) que NO deben pasar por
    // webpack. Se cargan directamente vía require() en runtime server.
    experimental: {
        serverComponentsExternalPackages: ['@napi-rs/canvas', 'sharp', '@resvg/resvg-js']
    },
    // Asegurar que public/fonts/ se incluye en el standalone build
    // (por defecto Next.js no traza assets estáticos al output, así
    // que las TTF de Inter no llegaban a producción).
    outputFileTracingIncludes: {
        '/api/**/*': ['./public/fonts/**/*']
    }
};

module.exports = nextConfig;
