FROM node:20-alpine AS deps
# v3 - force rebuild
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Chromium + libs para que puppeteer-core pueda renderizar HTML→PDF
# (tool attach_report_pdf_to_task de Sonia). Usamos el chromium del
# repo de Alpine (≈140MB) en vez de @sparticuz/chromium para evitar
# problemas de glibc — Alpine es musl.
RUN apk add --no-cache \
                libc6-compat openssl tini \
                chromium nss freetype harfbuzz ca-certificates ttf-freefont && \
        addgroup -g 1001 -S nodejs && \
                adduser -S nextjs -u 1001
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
                RUN mkdir -p ./public
                COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
                COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
                COPY --from=builder /app/node_modules ./node_modules
                COPY --from=builder /app/scripts ./scripts
                COPY --from=builder /app/lib ./lib
                COPY --from=builder /app/prisma ./prisma
                USER nextjs
                EXPOSE 8080
                ENV PORT=3000
                CMD ["sh", "-c", "echo 'Starting...' && npx prisma db push --accept-data-loss && npx tsx scripts/seed.ts; node server.js"]
                CMD ["sh", "-c", "npx prisma db push --accept-data-loss; npx tsx scripts/seed.ts; node server.js"]
                CMD ["sh", "-c", "npx prisma migrate deploy; node server.js"]

# cache bust v2
