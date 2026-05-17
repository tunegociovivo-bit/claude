/** @type {import('next').NextConfig} */
const NATIVE_PACKAGES = ['@napi-rs/canvas', 'sharp', '@resvg/resvg-js'];

// Timestamp del build (ms epoch). Se evalúa una vez al ejecutar
// `next build` y se inyecta como env pública. La UI lo lee para
// mostrar "hace 5 min" en el badge del sidebar y saber a simple
// vista si el deploy está al día.
const BUILD_TIMESTAMP = String(Date.now());

const nextConfig = {
    reactStrictMode: true,
    output: 'standalone',
    env: {
        NEXT_PUBLIC_BUILD_TIMESTAMP: BUILD_TIMESTAMP
    },
    // serverComponentsExternalPackages cubre Server Components. La
    // config webpack.externals de abajo cubre además Route Handlers
    // (app/api/.../route.ts), que es donde realmente se usan estos
    // paquetes con binarios nativos (.node). Sin la config webpack,
    // el build de Railway/Vercel falla con:
    //   Module parse failed: Unexpected character ' ' (1:0)
    //   trying to parse skia.linux-x64-musl.node as JS
    experimental: {
        serverComponentsExternalPackages: NATIVE_PACKAGES
    },
    outputFileTracingIncludes: {
        '/api/**/*': ['./public/fonts/**/*']
    },
    webpack: (config, { isServer }) => {
        if (!isServer) return config;

        // En Next 14.2 `config.externals` puede venir como array, como
        // función o como objeto. Cubrimos los tres casos envolviéndolo
        // siempre como función async — patrón recomendado por Next.
        const orig = config.externals;
        const wrapped = async (ctx) => {
            const req = ctx.request;
            if (req && NATIVE_PACKAGES.some((p) => req === p || req.startsWith(p + '/'))) {
                // commonjs externo: webpack emite `require("@napi-rs/canvas")`
                // sin tocar el módulo. Node lo resuelve contra node_modules
                // del contenedor en runtime.
                return `commonjs ${req}`;
            }
            if (typeof orig === 'function') return orig(ctx);
            if (Array.isArray(orig)) {
                for (const e of orig) {
                    if (typeof e === 'function') {
                        const r = await e(ctx);
                        if (r) return r;
                    } else if (typeof e === 'string' && e === req) {
                        return `commonjs ${req}`;
                    } else if (e && typeof e === 'object' && e[req]) {
                        return e[req];
                    }
                }
            }
            return undefined;
        };
        config.externals = [wrapped];
        return config;
    }
};

module.exports = nextConfig;
