#!/bin/bash
# Ejecutar EN EL VPS (como el usuario ivan):
#   bash deploy.sh
# La primera vez instala Node, clona el repo y registra el servicio systemd.
# Las siguientes veces solo actualiza el código y reinicia.
set -e

REPO="https://github.com/LlamaTrix/Prueba-server-gamemaker.git"
DIR="$HOME/Prueba-server-gamemaker"

# 1. Node.js (si no está instalado)
if ! command -v node >/dev/null; then
    echo "Instalando Node.js..."
    sudo apt-get update && sudo apt-get install -y nodejs npm
fi

# 2. Clonar o actualizar el repo
if [ -d "$DIR" ]; then
    cd "$DIR" && git pull
else
    git clone "$REPO" "$DIR"
    cd "$DIR"
fi

# 3. Registrar el servicio systemd (solo la primera vez o si cambió)
sudo cp deploy/gamemaker-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable gamemaker-server

# 4. Abrir el puerto en el firewall (si ufw está activo)
if command -v ufw >/dev/null; then
    sudo ufw allow 6510/tcp || true
fi

# 5. (Re)iniciar
sudo systemctl restart gamemaker-server
sleep 1
sudo systemctl status gamemaker-server --no-pager
echo "Listo. Logs en vivo con: journalctl -u gamemaker-server -f"
