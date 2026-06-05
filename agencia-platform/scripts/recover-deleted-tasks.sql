-- ============================================================================
-- RECUPERACIÓN DE TAREAS BORRADAS EN MASA (Hub Negocio Vivo)
-- ============================================================================
--
-- CONTEXTO
--   El borrado en masa de tareas (botón "seleccionar" + borrar) hacía un
--   borrado FÍSICO que NO pasaba por la papelera y arrastraba subtareas en
--   cascada. Pero ese borrado NO tocó la tabla `SearchEmbedding`, que guarda
--   el TÍTULO + DESCRIPCIÓN de cada tarea para la búsqueda semántica.
--   Por eso el contenido de las tareas borradas sigue ahí y se puede recuperar.
--
-- CÓMO EJECUTARLO
--   En Railway → servicio Postgres → pestaña de consulta (o `psql`), pega los
--   bloques de abajo. Empieza SIEMPRE por el PASO 1 (solo lee, no cambia nada).
--
-- LIMITACIÓN
--   De aquí se recupera TÍTULO + DESCRIPCIÓN (texto). NO se recupera columna,
--   fecha de entrega, responsables ni la relación padre/subtarea: eso solo
--   está en una copia de seguridad de la base de datos. Para el contenido,
--   esto es suficiente para reconstruir las tareas.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 (SOLO LECTURA): listar las tareas borradas y su contenido.
--   Son las embeddings de tipo TASK cuya tarea ya no existe en `Task`.
--   Localiza las de "REUNIONES Y LLAMADAS" por el título.
-- ----------------------------------------------------------------------------
SELECT
  se."entityId"                               AS id_tarea_borrada,
  split_part(se."text", E'\n\n', 1)           AS titulo,
  se."text"                                   AS titulo_y_descripcion,
  se."workspaceId",
  se."createdAt"                              AS indexada_el,
  se."updatedAt"                              AS ultima_edicion
FROM "SearchEmbedding" se
WHERE se."entityType" = 'TASK'
  AND NOT EXISTS (
    SELECT 1 FROM "Task" t WHERE t.id = se."entityId"
  )
ORDER BY se."updatedAt" DESC;


-- ----------------------------------------------------------------------------
-- PASO 2 (OPCIONAL · RE-CREAR las tareas): vuelve a crearlas como tareas
-- nuevas con su título y descripción, en el proyecto y la columna que indiques.
--
-- ANTES DE EJECUTAR, rellena:
--   :proyecto_id  → id del proyecto "NEGOCIO VIVO GENERAL"  (mira PASO 3)
--   :columna      → nombre EXACTO de la columna, p.ej. 'REUNIONES Y LLAMADAS'
--   la lista de ids → pega en el IN (...) SOLO los id_tarea_borrada del PASO 1
--                     que quieras recuperar (para no recrear borrados antiguos).
--
-- Crea las tareas con un prefijo "[RECUPERADA] " en el título para que las
-- reconozcas; quítalo cuando confirmes que están bien.
-- ----------------------------------------------------------------------------
/*
INSERT INTO "Task" (
  id, "workspaceId", "projectId", "clientId",
  title, description, status, priority, "dueAllDay", "order",
  recurrence, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  se."workspaceId",
  p.id,
  p."clientId",
  '[RECUPERADA] ' || split_part(se."text", E'\n\n', 1),
  NULLIF(substring(se."text" FROM position(E'\n\n' IN se."text") + 2), ''),
  :columna,            -- nombre de la columna kanban (status)
  'MEDIUM',
  true,
  0,
  'none',
  now(),
  now()
FROM "SearchEmbedding" se
JOIN "Project" p ON p.id = :proyecto_id
WHERE se."entityType" = 'TASK'
  AND se."entityId" IN (
    -- pega aquí los ids del PASO 1 que quieras recuperar:
    'PEGAR_ID_1',
    'PEGAR_ID_2'
  );
*/


-- ----------------------------------------------------------------------------
-- PASO 3 (AYUDA): encontrar el id del proyecto "NEGOCIO VIVO GENERAL".
-- ----------------------------------------------------------------------------
-- SELECT id, name FROM "Project" WHERE name ILIKE '%negocio vivo%';
