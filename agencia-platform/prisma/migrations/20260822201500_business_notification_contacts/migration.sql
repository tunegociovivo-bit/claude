ALTER TABLE "BipiBusiness"
  ADD COLUMN IF NOT EXISTS "notificationEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "notificationWhatsapp" TEXT;
