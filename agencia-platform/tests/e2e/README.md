# Tests E2E

Cubren los flujos críticos del Hub. Si rompen, el trabajo diario se rompe.

## Setup primera vez

```bash
npm install
npm run test:e2e:install   # baja Chromium
```

## Cómo correr

```bash
# Asegúrate de que la app está en http://localhost:3000
npm run dev &

# En otro terminal:
npm run test:e2e           # corre todos en headless
npm run test:e2e:ui        # interactivo con UI mode (debuggear paso a paso)
```

## Variables de entorno

| Var | Default | Para qué |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` | URL donde corre la app |
| `E2E_USER_EMAIL` | `e2e@test.local` | User de pruebas existente en la BD |
| `E2E_USER_PASSWORD` | `e2e-password-123` | Contraseña de ese user |

Si el user no existe, los tests autenticados se **skipean**, no fallan. Esto permite que CI corra incluso si la BD está limpia: los smoke tests no-auth siguen ejecutándose.

## Qué se cubre hoy

- `auth.spec.ts` — login funciona y aterriza en una página autenticada.
- `tasks.spec.ts` — crear una tarea desde `/tareas` y verificar que aparece.
- `mi-dia.spec.ts` — `/mi-dia` carga sin errores y el atajo Cmd+K abre el palette.

## Seed reproducible

```bash
DATABASE_URL=postgres://... npm run test:e2e:seed
```

Crea (o resetea):
- Workspace con slug `e2e` (configurable con `E2E_WORKSPACE_SLUG`)
- User admin `e2e@test.local` / `e2e-password-123`
- Cliente "E2E Cliente", proyecto "E2E Proyecto", tarea "E2E Tarea de muestra"
- ClientApprovalLink válido por 90 días

Es idempotente — re-ejecutar no duplica nada.

## Tests que dependen del seed

- `clientes.spec.ts` — verifica que la lista de clientes muestra "E2E Cliente"
- `portal-cliente.spec.ts` — abre `/p/cliente/[token]` con el link del seed y comprueba que el portal público carga
- `comentarios.spec.ts` — abre la tarea "E2E Tarea de muestra", escribe un comentario rich y verifica que aparece en el hilo

Si el seed no se ha ejecutado, esos tests se **skipean** (no fallan) con mensaje claro.

## Pendiente para próximos pases

- Comentar en una tarea (con el editor rich)
- Subir un adjunto a una tarea
- Aprobar un post desde `/p/editorial/[token]`
