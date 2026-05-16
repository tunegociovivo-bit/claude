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

## Pendiente para próximos pases

- Crear un cliente desde `/clientes`
- Subir un adjunto a una tarea
- Comentar en una tarea
- Aprobar un post desde el portal público (con un `ClientApprovalLink` seedeado)
