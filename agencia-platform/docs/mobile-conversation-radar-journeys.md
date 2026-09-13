# F-Móviles: Radar de conversaciones

## Recorridos de usuario

1. Una persona administradora configura una regla reutilizable con el tema que le interesa, el objetivo de sus respuestas y el tono. La regla queda guardada solo en ese navegador y asociada al móvil.
2. Con Facebook, Instagram u otra aplicación abierta en el móvil, pulsa **Analizar pantalla visible**. F-Móviles captura únicamente esa pantalla en ese momento y no guarda la imagen ni el texto reconocido.
3. La IA devuelve como máximo doce comentarios visibles y realmente relacionados con la regla, ordenados por relevancia y sin duplicados. Cada resultado incluye el fragmento detectado, el motivo y una respuesta editable que no inventa hechos.
4. La persona revisa cada propuesta y puede aprobarla, editarla o descartarla. Aprobar copia el texto al portapapeles del móvil; pegarlo requiere una acción explícita con el campo de respuesta ya enfocado.
5. F-Móviles nunca pulsa **Enviar/Publicar**, nunca recorre el grupo de forma desatendida y nunca actúa sobre contenido que no esté visible en la captura solicitada.

## Garantías verificables

- Solo se admiten capturas JPEG o PNG válidas y de hasta 2,5 MiB.
- El texto que aparezca dentro de la captura se trata como contenido no fiable, no como instrucciones para la IA.
- Los resultados incompletos, duplicados o con baja relevancia se eliminan antes de llegar a la interfaz.
- Las reglas locales dañadas o manipuladas se ignoran con seguridad.
- Capturas, autores, comentarios y respuestas no se persisten en la base de datos.
