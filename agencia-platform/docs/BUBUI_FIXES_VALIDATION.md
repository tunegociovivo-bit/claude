# Bubui — evidencia de validación local

## Regresión visual: compra pendiente

RED comprobado el 29-09-2026 en la compilación local y PostgreSQL aislado:
- Una amiga ficticia registra 250 € con un cupón del 20%.
- La base de datos devuelve `pending`, descuento previsto 50 €.
- La web muestra «¡Ahorro aplicado!» y «Te has llevado ... 50.00 €».
- Esperado: «Compra pendiente de confirmación», sin anunciar ahorro consumado.
- Evidencia externa al repositorio: `outputs/bubui-web-pendiente-antes.png`.

Esta comprobación usa una sesión ficticia preparada localmente, no valida el alta por SMS.
