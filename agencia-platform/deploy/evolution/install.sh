#!/usr/bin/env bash
# Instalador de Evolution API (WhatsApp con notas de voz, gratis).
#
# Uso:
#   ./install.sh evolution.negociovivo.app   # HTTPS recomendado (necesita DNS A -> IP del VPS)
#   ./install.sh                              # HTTP rápido en el puerto 8080
#
# Genera las claves solo, crea el .env y levanta los contenedores.
# Al final imprime la URL y la API key que debes pegar en el Hub.
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:-}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: falta '$1'. Instálalo y reintenta."; exit 1; }; }
need docker
need openssl

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

if [ ! -f .env ]; then
  echo "==> Generando .env con claves seguras"
  API_KEY="$(openssl rand -hex 24)"
  DB_PASS="$(openssl rand -hex 16)"
  PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || echo TU_IP)"
  {
    echo "EVOLUTION_API_KEY=$API_KEY"
    echo "POSTGRES_PASSWORD=$DB_PASS"
    echo "SERVER_URL=http://$PUBLIC_IP:8080"
    echo "EVOLUTION_DOMAIN=${DOMAIN:-evolution.negociovivo.app}"
  } > .env
  chmod 600 .env
else
  echo "==> .env ya existe; lo reutilizo (no toco las claves)"
fi

# Si se pasó dominio por argumento, fijarlo en el .env
if [ -n "$DOMAIN" ]; then
  if grep -q '^EVOLUTION_DOMAIN=' .env; then
    sed -i "s|^EVOLUTION_DOMAIN=.*|EVOLUTION_DOMAIN=$DOMAIN|" .env
  else
    echo "EVOLUTION_DOMAIN=$DOMAIN" >> .env
  fi
fi

if [ -n "$DOMAIN" ]; then
  echo "==> Levantando Evolution con HTTPS en https://$DOMAIN"
  echo "    (asegúrate de tener un DNS A: $DOMAIN -> IP de este VPS, y los puertos 80/443 abiertos)"
  $DC -f docker-compose.https.yml up -d
  URL="https://$DOMAIN"
else
  echo "==> Levantando Evolution en HTTP (puerto 8080) — abre el 8080 en el firewall"
  $DC up -d
  URL="$(grep '^SERVER_URL=' .env | cut -d= -f2-)"
fi

API_KEY_OUT="$(grep '^EVOLUTION_API_KEY=' .env | cut -d= -f2-)"

echo
echo "================== LISTO =================="
echo "Pega esto en el Hub (/admin/leads -> Ajustes -> WhatsApp):"
echo
echo "  Proveedor:  Evolution API"
echo "  URL:        $URL"
echo "  API key:    $API_KEY_OUT"
echo "  Instancia:  sonia"
echo
echo "Luego: Guardar -> Probar conexión -> Reconectar -> escanea el QR."
echo "==========================================="
