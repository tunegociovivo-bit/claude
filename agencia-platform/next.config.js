/** @type {import('next').NextConfig} */
// Binarios nativos (.node) + pdf-parse/pdf.js: NO se empaquetan con webpack;
// se cargan desde node_modules en runtime. pdf-parse, si se bundlea, falla con
// "Cannot find module pdf.worker.mjs" (el worker de pdf.js).
const NATIVE_PACKAGES = ['@napi-rs/canvas', 'sharp', '@resvg/resvg-js', 'archiver', 'pdf-parse', 'ffmpeg-static'];

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
    // Plataforma interna privada: cabecera HTTP que impide indexación en
    // TODAS las respuestas (incluye assets y rutas no-HTML, que la meta
    // tag no cubre). Es la señal más fuerte para Google/Bing.
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    {
                        key: 'X-Robots-Tag',
                        value: 'noindex, nofollow, noarchive, nosnippet, noimageindex'
                    }
                ]
            }
        ];
    },
    // Compatibilidad tras el rebrand Bipi → Bubui: las rutas antiguas
    // /bipi/* siguen sirviendo el contenido nuevo /bubui/* para no romper
    // QR impresos ni la app nativa instalada antes del cambio.
    async rewrites() {
        return [
            { source: '/bipi/:path*', destination: '/bubui/:path*' },
            { source: '/api/bipi/:path*', destination: '/api/bubui/:path*' },
            { source: '/bipi-sw.js', destination: '/bubui-sw.js' }
        ];
    },
    // serverComponentsExternalPackages cubre Server Components. La
    // config webpack.externals de abajo cubre además Route Handlers
    // (app/api/.../route.ts), que es donde realmente se usan estos
    // paquetes con binarios nativos (.node). Sin la config webpack,
    // el build de Railway/Vercel falla con:
    //   Module parse failed: Unexpected character ' ' (1:0)
    //   trying to parse skia.linux-x64-musl.node as JS
    experimental: {
        serverComponentsExternalPackages: NATIVE_PACKAGES,
        // Activa instrumentation.ts → planificador interno de crons
        // (recordatorios + briefing) sin cron externo.
        instrumentationHook: true,
        // outputFileTracingIncludes vive en `experimental` en Next 14.x.
        // /public/fonts es necesario para el overlay del editorial.
        // /chrome-extension es la carpeta fuente de la extensión que
        // se sirve zipeada al vuelo en /api/v1/extension/download —
        // sin incluirla en el trace, Railway no la bundlea en el
        // standalone build y el endpoint 404ea en producción.
        outputFileTracingIncludes: {
            '/api/**/*': [
                './public/fonts/**/*',
                './chrome-extension/**/*',
                // pdf.js worker: garantiza que el .mjs esté en el standalone
                // (lo usa pdf-parse al leer PDFs de facturas de Meta).
                './node_modules/pdfjs-dist/build/pdf.worker.mjs',
                './node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
                // binario de ffmpeg (montaje de tomas del vídeo editorial)
                './node_modules/ffmpeg-static/ffmpeg',
                // next/og (ImageResponse): el tracer del standalone NO copia los
                // assets internos de @vercel/og (wasm de resvg/yoga + fuente por
                // defecto), así que al renderizar el worker CRASHEABA → 502.
                // Forzamos su inclusión para mockup, ranking, top-badge, etc.
                './node_modules/next/dist/compiled/@vercel/og/**/*'
            ],
            // Rutas de imagen FUERA de /api (OG image de invitaciones Bubui).
            '/bubui/**/*': [
                './node_modules/next/dist/compiled/@vercel/og/**/*'
            ]
        }
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
