# Prueba servidor GameMaker — Lobby + Chat online

Juego online de pelea (en desarrollo). Por ahora: el cliente de GameMaker se
conecta a un servidor Node.js, elige un nombre de usuario, entra a un lobby y
puede chatear con los demás jugadores.

## Estructura

| Carpeta | Qué es |
|---|---|
| `server/` | Servidor Node.js (TCP, sin dependencias) — corre en el VPS |
| `Prueba Juego Online/` | Proyecto de GameMaker (el cliente del juego) |
| `Goku_mejorado/` | Sprites de Goku para el juego de pelea (próxima etapa) |
| `deploy/` | Script de despliegue y servicio systemd para el VPS |

## Protocolo de red

TCP con sockets **raw** (`network_connect_raw` / `network_send_raw` en GameMaker,
porque el servidor no es otro juego de GameMaker). Cada trama:

```
[u16 LE: largo del payload][payload]
payload = [u8 id de mensaje][...datos]
strings = UTF-8 terminados en NUL (formato buffer_string de GameMaker)
```

| ID | Mensaje | Dirección | Datos |
|---|---|---|---|
| 1 | `MSG_JOIN` | cliente → servidor | string nombre |
| 2 | `MSG_WELCOME` | servidor → cliente | u16 uid + u16 x + u16 y |
| 3 | `MSG_PLAYER_LIST` | servidor → todos | u16 cantidad + N strings |
| 4 | `MSG_CHAT` | cliente → servidor: string texto · servidor → todos: string nombre, string texto |
| 5 | `MSG_ACTIVITY` | cliente → servidor | sin datos; movimiento del personaje |
| 6 | `MSG_KICK` | servidor → cliente | string motivo |
| 7 | `MSG_LEAVE` | cliente → servidor | sin datos; cierre voluntario |
| 8 | `MSG_WORLD` | servidor → clientes | lista de UID, nombre, posición y dirección |
| 9 | `MSG_POS` | ambos | posición y dirección del jugador |
| 10 | `MSG_BUBBLE` | servidor → clientes | UID + texto para la burbuja de chat |
| 11 | `MSG_ATTACK` | cliente → servidor | tipo de golpe + nivel de carga |
| 12 | `MSG_HIT` | servidor → clientes | UID objetivo + golpe, dirección y carga |

El servidor marca al jugador como `[AFK]` tras 60 segundos sin movimiento. Si
no vuelve a moverse durante los 20 segundos siguientes, lo expulsa y cierra su
socket. Moverse durante ese margen elimina inmediatamente el estado AFK.

## Probar en local

```bash
cd server
node server.js            # escucha en el puerto 6510
```

En `scripts/scr_net/scr_net.gml` cambia temporalmente `SERVER_HOST` a
`"127.0.0.1"`, ejecuta el juego, elige un nombre y chatea.

El cliente usa TCP raw, así que esta prueba debe compilarse para **Windows**
(o para otra plataforma nativa con sockets TCP). Un navegador HTML5 no puede
abrir directamente `prueba.minecruz.com:6510`; para HTML5 haría falta añadir
un transporte WebSocket en el servidor y en el cliente.

## Diagnóstico del cliente

El estado de red y el parser están centralizados en `scr_net`. El objeto
`obj_client` diferencia ahora entre conexión TCP e ingreso confirmado por
`MSG_WELCOME`, valida y separa las tramas, ignora eventos de sockets antiguos,
aplica un timeout de 10 segundos y permite reconectar con la tecla `R`.

Al generar un ejecutable nuevo para Windows, el archivo se llama
`PruebaJuegoOnline.exe`. Borra o deja de distribuir el antiguo `new_blank.exe`
para evitar ejecutar una compilación que todavía tenga la configuración vieja.

## Desplegar en el VPS

```bash
ssh ivan@62.84.184.67
# la primera vez:
git clone https://github.com/LlamaTrix/Prueba-server-gamemaker.git
bash Prueba-server-gamemaker/deploy/deploy.sh
```

Para actualizar después de un cambio, basta con volver a correr
`bash Prueba-server-gamemaker/deploy/deploy.sh`.

Logs del servidor: `journalctl -u gamemaker-server -f`

> **Nota (firewall):** el VPS usa HestiaCP, que maneja su propio firewall
> iptables (las reglas de `ufw` NO tienen efecto). El puerto ya quedó abierto
> con:
> ```bash
> sudo /usr/local/hestia/bin/v-add-firewall-rule ACCEPT 0.0.0.0/0 6510 TCP juego-gamemaker
> ```

## Próximos pasos (plan)

1. **Chat** ✅ (esta etapa)
2. Sincronizar posición de los jugadores en una sala (mensajes `MSG_POS` a ~15/seg)
3. Importar los sprites de `Goku_mejorado/` como sprites del proyecto y animar al personaje
4. Golpes / colisiones validadas por el servidor, vida y KO
5. Salas de pelea 1 vs 1 desde el lobby
