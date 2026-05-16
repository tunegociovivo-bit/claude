/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    output: 'standalone',
    // Paquetes con binarios nativos (.node) que NO deben pasar por
    // webpack. `serverComponentsExternalPackages` cubre Server
    // Components; la config de `webpack` de abajo cubre además las
    // Route Handlers (app/api/.../route.ts), que es donde realmente
    // se importan estos paquetes (overlay con sharp / canvas /
    // resvg). Sin la config webpack, el build de Railway / Vercel
    // falla con:
    //   Module parse failed: Unexpected character ' ' (1:0)
    //   trying to parse skia.linux-x64-musl.node as JS
    experimental: {
        serverComponentsExternalPackages: ['@napi-rs/canvas', 'sharp', '@resvg/resvg-js']
    },
    // Asegurar que public/fonts/ se incluye en el standalone build
    // (por defecto Next.js no traza assets estáticos al output, así
    // que las TTF de Inter no llegaban a producción).
    outputFileTracingIncludes: {
        '/api/**/*': ['./public/fonts/**/*']
    },
    webpack: (config, { isServer }) => {
        if (isServer) {
            // Marca estos paquetes como "externals": webpack no los
            // bundlea, sigue siendo require() en runtime contra el
            // node_modules del contenedor Docker. Imprescindible para
            // que los .node nativos no pasen por loaders JS.
            const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
            externals.push('@napi-rs/canvas', 'sharp', '@resvg/resvg-js');
            config.externals = externals;
        }
        return config;
    }
};

module.exports = nextConfig;
