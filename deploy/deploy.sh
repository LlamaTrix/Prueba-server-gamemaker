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

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "Se requiere Node.js 18 o posterior (instalado: $(node --version))." >&2
    exit 1
fi

# 2. Clonar o actualizar el repo
if [ -d "$DIR" ]; then
    cd "$DIR" && git pull
else
    git clone "$REPO" "$DIR"
    cd "$DIR"
fi

# 3. Dependencias y directorio privado de la base documental
cd "$DIR/server"
npm ci --omit=dev
install -d -m 700 "$DIR/server/data"
cd "$DIR"

# 4. Registrar el servicio systemd (solo la primera vez o si cambió)
sudo cp deploy/gamemaker-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable gamemaker-server

# 5. Abrir el puerto en el firewall (si ufw está activo)
if command -v ufw >/dev/null; then
    sudo ufw allow 6510/tcp || true
fi

# 6. (Re)iniciar
sudo systemctl restart gamemaker-server
sleep 1
sudo systemctl status gamemaker-server --no-pager
echo "Listo. Logs en vivo con: journalctl -u gamemaker-server -f"
