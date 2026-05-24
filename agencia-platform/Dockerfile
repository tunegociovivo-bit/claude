FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* .npmrc ./
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

# IMPORTANTE: el CMD del runner NO ejecuta `npx tsx scripts/seed.ts`.
# El seed borra TODOS los datos y crea cuentas demo (u1..u10@agencia.local
# con password "agencia123") — si se ejecuta accidentalmente contra
# producción es una fuga de seguridad + pérdida total de datos.
#
# Antes había 3 CMDs distintos en este Dockerfile (Docker solo respeta
# el último, pero los 2 anteriores incluían `npx tsx scripts/seed.ts` y
# eran confusos). Si en algún build histórico se aplicó el penúltimo o
# alguien lanzó manualmente el seed, las cuentas demo quedaron en BD —
# de ahí la fuga reportada. Para ejecutar el seed contra LOCAL, hazlo
# manualmente con `ALLOW_SEED=1 npx tsx scripts/seed.ts`.
# Sincroniza el schema con `prisma db push` (este proyecto NO usa migraciones
# — carpeta prisma/migrations vacía—, así que `migrate deploy` era un no-op y
# las tablas nuevas del schema, p.ej. BackupRun, nunca llegaban a producción).
# Mismos flags que el `start` de package.json: no acepta pérdida de datos.
# Usamos `;` para que la app arranque aunque el push falle (disponibilidad).
CMD ["sh", "-c", "npx prisma db push --accept-data-loss=false --skip-generate; node server.js"]
