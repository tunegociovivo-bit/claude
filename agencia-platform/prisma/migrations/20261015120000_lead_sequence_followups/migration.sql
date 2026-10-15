-- Secuencias de Leads: el siguiente paso espera al envío real del anterior.
ALTER TABLE "LeadSequenceAssignment" ADD COLUMN IF NOT EXISTS "lastMessageId" TEXT;

-- Pasos duplicados creados por importaciones repetidas (mismo orden, texto,
-- tipo, canal y retraso): se deja uno. Sin duplicados no borra nada.
DELETE FROM "LeadSequenceStep" a
USING "LeadSequenceStep" b
WHERE a."sequenceId" = b."sequenceId"
  AND a."order" = b."order"
  AND a."templateBody" = b."templateBody"
  AND a."kind" = b."kind"
  AND a."channel" = b."channel"
  AND a."delayHours" = b."delayHours"
  AND a."delayDays" = b."delayDays"
  AND a."id" > b."id";
