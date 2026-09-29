# Bubui — evidencia de validación local

## Regresión visual: compra pendiente

RED comprobado el 29-09-2026 en la compilación local y PostgreSQL aislado:
- Una amiga ficticia registra 250 € con un cupón del 20%.
- La base de datos devuelve `pending`, descuento previsto 50 €.
- La web muestra «¡Ahorro aplicado!» y «Te has llevado ... 50.00 €».
- Esperado: «Compra pendiente de confirmación», sin anunciar ahorro consumado.
- Evidencia externa al repositorio: `outputs/bubui-web-pendiente-antes.png`.

Esta comprobación usa una sesión ficticia preparada localmente, no valida el alta por SMS.

GREEN: repetido el mismo circuito en navegador local tras la corrección. La pantalla muestra Compra pendiente de confirmación, ahorro previsto de 50 € y explica que el reto solo cuenta cuando el comercio confirma. Evidencia: outputs/bubui-web-pendiente-corregido.png. Tipos comprobados sin errores.

