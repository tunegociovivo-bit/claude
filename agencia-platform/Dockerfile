FROM node:20-alpine AS deps
ARG CACHEBUST=2
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
RUN apk add --no-cache libc6-compat openssl tini && \
        addgroup -g 1001 -S nodejs && \
                adduser -S nextjs -u 1001
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
                ENV HOSTNAME=0.0.0.0
                CMD ["sh", "-c", "npx prisma db push --accept-data-loss; npx tsx scripts/seed.ts; node server.js"]
                CMD ["sh", "-c", "npx prisma migrate deploy; node server.js"]

# cache bust v2
