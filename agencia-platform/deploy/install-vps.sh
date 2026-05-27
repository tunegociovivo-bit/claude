#!/usr/bin/env bash
# Script de instalación rápida en un VPS Ubuntu 22.04/24.04
# Uso: bash install-vps.sh
set -euo pipefail

echo "==> Actualizando paquetes…"
sudo apt update && sudo apt upgrade -y

echo "==> Instalando dependencias del sistema…"
sudo apt install -y ca-certificates curl gnupg ufw git

echo "==> Instalando Docker…"
if ! command -v docker >/dev/null 2>&1; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" |
        sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "==> Configurando firewall…"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo ""
echo "Listo. Pasos siguientes:"
echo "  1. git clone <url-de-tu-repo> agencia-hub && cd agencia-hub/agencia-platform"
echo "  2. cp .env.example .env  &&  edita .env con tus secretos y dominios"
echo "  3. sudo docker compose up -d --build"
echo "  4. sudo docker compose exec app npm run db:seed   # primera vez"
