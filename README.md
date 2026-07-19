# Prueba Juego Online

Prototipo de pelea multijugador hecho con GameMaker y un servidor autoritativo en Node.js. El cliente dispone de registro e inicio de sesión, lista de servidores, lobby, chat, movimiento, combate cuerpo a cuerpo, ki y proyectiles.

La sala mide **4000 × 4000 px**. La ventana y la cámara miden **400 × 400 px**, y la cámara sigue al personaje local.

## Estructura

| Ruta | Contenido |
|---|---|
| `Prueba Juego Online/` | Proyecto y cliente de GameMaker para escritorio y HTML5 |
| `server/server.js` | TCP, WebSocket, REST y simulación autoritativa |
| `server/auth-store.js` | Cuentas, contraseñas y sesiones |
| `server/data/` | Base documental y secreto de autenticación; se crea al ejecutar el servidor |
| `deploy/` | Servicio systemd, script de despliegue y ubicaciones de nginx |

## Flujo de acceso

El nombre que aparece en la partida pertenece a una cuenta y ya no se acepta directamente desde el socket:

1. El jugador se registra o inicia sesión mediante REST.
2. El servidor devuelve un token de sesión firmado, válido por 24 horas.
3. El cliente consulta la lista de servidores.
4. Al elegir el servidor, solicita un ticket de juego con el token de sesión.
5. El cliente conecta por TCP o WSS y envía el ticket dentro de `MSG_JOIN`.
6. El servidor consume el ticket, obtiene la identidad autenticada y crea al jugador en una posición aleatoria.

El ticket de juego vence a los **30 segundos** y es de **un solo uso**. No es la contraseña ni el token de sesión. El token de sesión puede reutilizarse hasta que venza o sea revocado; está firmado con HMAC-SHA-256 y no contiene la contraseña.

No puede haber dos conexiones simultáneas con la misma cuenta. Los nombres se normalizan y su unicidad no distingue mayúsculas de minúsculas.

## API REST

En producción, la base es `https://jugar.minecruz.com`. En local, el servicio escucha por defecto en `http://127.0.0.1:6511`.

Todas las respuestas de la API son JSON. Los errores tienen la forma:

```json
{ "ok": false, "code": "CODIGO", "error": "Descripción" }
```

| Método | Ruta | Autenticación | Función |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | Crea la cuenta y devuelve una sesión |
| `POST` | `/api/auth/login` | No | Comprueba las credenciales y devuelve una sesión |
| `GET` | `/api/servers` | No | Devuelve servidores, jugadores y direcciones TCP/WSS |
| `POST` | `/api/game-ticket` | Bearer | Emite un ticket de un solo uso para el servidor elegido |
| `GET` | `/status.json` | No | Estado básico y jugadores conectados |

Registro e inicio de sesión reciben `username` y `password`. El nombre debe tener entre 3 y 24 caracteres; la contraseña, entre 8 y 128.

```bash
curl -X POST https://jugar.minecruz.com/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"Goku","password":"Una-Clave-Segura"}'

curl -X POST https://jugar.minecruz.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"Goku","password":"Una-Clave-Segura"}'

curl https://jugar.minecruz.com/api/servers

curl -X POST https://jugar.minecruz.com/api/game-ticket \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN_DE_SESION' \
  -d '{"serverId":"principal"}'
```

Hay un límite de 20 intentos de registro/inicio de sesión por dirección IP cada 10 minutos. El cuerpo máximo aceptado por la API es de 8 KiB.

## Base documental NoSQL

Las cuentas se guardan como documentos JSON locales en `server/data/users.json`. Es un almacén documental NoSQL sencillo, sin un proceso externo de base de datos.

- Nunca se persisten contraseñas en texto plano.
- Cada contraseña usa una sal aleatoria y un hash derivado con `scrypt`.
- Las comparaciones de credenciales y firmas se realizan de forma segura.
- Las escrituras se serializan y se reemplaza el documento de forma atómica.
- `server/data/auth-secret` contiene el secreto que firma las sesiones, salvo que se suministre `AUTH_TOKEN_SECRET`.
- Los permisos de despliegue dejan `server/data/` privado para el usuario del servicio.

`server/data/` **no se versiona**. No añadas `users.json` ni `auth-secret` a Git. En producción se debe respaldar el directorio completo de forma cifrada y con acceso restringido; perder `users.json` pierde las cuentas y perder o cambiar `auth-secret` invalida las sesiones existentes.

## Protocolo de juego

TCP nativo y WebSocket usan la misma trama binaria little-endian:

```text
[u16 longitud del payload][payload]
payload = [u8 id del mensaje][datos]
string = UTF-8 terminado en NUL
```

El cliente de escritorio usa TCP en `prueba.minecruz.com:6510`. HTML5 usa `wss://jugar.minecruz.com/ws/`.

| ID | Mensaje | Dirección | Contenido principal |
|---:|---|---|---|
| 1 | `MSG_JOIN` | cliente → servidor | string ticket de juego |
| 2 | `MSG_WELCOME` | servidor → cliente | `uid`, `x`, `y` |
| 3 | `MSG_PLAYER_LIST` | servidor → clientes | nombres y estado AFK |
| 4 | `MSG_CHAT` | ambos | texto de chat |
| 5 | `MSG_ACTIVITY` | cliente → servidor | actividad sin movimiento |
| 6 | `MSG_KICK` | servidor → cliente | motivo |
| 7 | `MSG_LEAVE` | cliente → servidor | salida voluntaria |
| 9 | `MSG_POS` | servidor → clientes | posición puntual autoritativa; los envíos del cliente se ignoran |
| 10 | `MSG_BUBBLE` | servidor → clientes | `uid` y texto sobre el personaje |
| 11 | `MSG_ATTACK` | cliente → servidor | tipo, carga, fase y secuencia de acción |
| 13 | `MSG_ATTACK_STATE` | servidor → clientes | animación del atacante |
| 14 | `MSG_STATS` | servidor → clientes | ki frecuente; el byte legado de vida se ignora en el cliente |
| 15 | `MSG_KI_CHARGE` | cliente → servidor | iniciar o detener recarga |
| 16 | `MSG_KI_FIRE` | cliente → servidor | solicitud de disparo |
| 17 | `MSG_KI_STATE` | servidor → clientes | animación de carga/disparo |
| 18 | `MSG_DASH` | cliente → servidor | dirección lateral |
| 19 | `MSG_DASH_STATE` | servidor → clientes | dash confirmado |
| 21 | `MSG_INPUT` | cliente → servidor | secuencia, ejes y dirección visual |
| 23/24 | `MSG_PING` / `MSG_PONG` | ambos | medición de RTT |
| 25 | `MSG_NAME_REJECT` | servidor → cliente | ticket inválido o cuenta ya conectada |
| 26/27 | `MSG_SERVER_QUERY` / `MSG_SERVER_INFO` | ambos | consulta binaria del servidor |
| 28 | `MSG_COMBAT_EVENT` | servidor → clientes | resultado completo de un impacto |
| 29 | `MSG_PROJECTILE_SPAWN` | servidor → clientes | creación autoritativa de proyectil |
| 30 | `MSG_PROJECTILE_DESTROY` | servidor → clientes | impacto o expiración de proyectil |
| 31 | `MSG_WORLD_STATE` | servidor → clientes | jugadores, vida, ki y revisión de estado |
| 32 | `MSG_WORLD_SNAPSHOT` | servidor → clientes | posiciones y secuencias confirmadas |

Los IDs antiguos `MSG_WORLD` (8), `MSG_HIT` (12) y `MSG_KI_HIT` (20) quedaron retirados. El servidor no acepta que el cliente decida una posición, un impacto ni la vida restante.

### Mensajes autoritativos nuevos

`MSG_COMBAT_EVENT` (28) incluye `eventId`, atacante, objetivo, revisión del objetivo, tipo, daño, vida/ki finales, dirección, carga, desplazamiento y posición final. El cliente aplica el valor final de vida una sola vez según la revisión; no vuelve a calcular ni resta daño localmente.

`MSG_PROJECTILE_SPAWN` (29) identifica el proyectil, propietario, posición y dirección. `MSG_PROJECTILE_DESTROY` (30) informa la posición final y si hubo impacto. La colisión, el daño y los 180 ticks de vida del proyectil se simulan en el servidor; el cliente sólo lo representa.

`MSG_WORLD_STATE` (31) es el estado completo usado al entrar o salir jugadores: por cada uno transmite UID, nombre, posición, dirección, vida, ki y revisión. `MSG_WORLD_SNAPSHOT` (32) se emite a 20 Hz y contiene UID, última secuencia de entrada confirmada, posición y dirección.

## Simulación del juego

El servidor es la única autoridad del estado compartido:

- Simula movimiento a 60 Hz y a 180 px/s, independientemente del FPS o de la cantidad de paquetes enviados.
- Normaliza el movimiento diagonal, descarta secuencias viejas y detiene una entrada que no se renueva en 750 ms.
- El cliente puede predecir su movimiento, pero reconcilia con snapshots del servidor.
- La vida empieza en 100. Un golpe normal quita 3 y uno fuerte quita 5 más su nivel de carga.
- El servidor valida alcance, secuencia, cadencia y bloqueo antes de confirmar un golpe.
- Los golpes fuertes aplican el empuje y la posición final en el mismo evento de combate.
- El ki empieza en 0, llega hasta 100 y la recarga autoritativa genera aproximadamente 60 puntos por segundo.
- Cada proyectil cuesta 5 de ki, avanza a 6 px por tick, dura hasta 180 ticks y causa 3 de daño.
- El dash cuesta 5 de ki, mueve 30 px y tiene un segundo de enfriamiento.

Tras 60 segundos sin actividad de movimiento se marca al jugador como `[AFK]`; a los 20 segundos adicionales se lo expulsa.

## Probar en local

Requiere una versión compatible de Node.js y npm.

```bash
cd server
npm ci
node --check server.js
node --test auth-store.test.js
node server.js
```

Puertos predeterminados:

- `6510`: TCP nativo, expuesto para el cliente de escritorio.
- `6511`: REST/estado, enlazado a `127.0.0.1` y publicado por nginx.
- `6512`: WebSocket, enlazado a `127.0.0.1` y publicado por nginx.

Para una prueba aislada se pueden cambiar con variables de entorno:

```bash
PORT=16510 HTTP_PORT=16511 WS_PORT=16512 node server.js
```

También se admiten `AUTH_DB_PATH`, `AUTH_SECRET_PATH`, `AUTH_TOKEN_SECRET`, `CORS_ORIGINS`, `AFK_AFTER_MS` y `KICK_AFTER_MS`.

## Despliegue

En el VPS:

```bash
ssh ivan@62.84.184.67
git clone https://github.com/LlamaTrix/Prueba-server-gamemaker.git
bash Prueba-server-gamemaker/deploy/deploy.sh
```

En actualizaciones posteriores se vuelve a ejecutar el mismo script. El despliegue hace `npm ci --omit=dev`, prepara `server/data/` con permisos privados, instala el servicio systemd y reinicia el servidor.

```bash
journalctl -u gamemaker-server -f
```

### nginx y HestiaCP

El bloque HTTPS de `jugar.minecruz.com` debe incluir las ubicaciones de [`deploy/nginx-jugar-locations.conf`](deploy/nginx-jugar-locations.conf). Son necesarias para publicar:

- `/api/` → REST en `127.0.0.1:6511`.
- `/status.json` → estado en `127.0.0.1:6511`.
- `/ws/` → WebSocket en `127.0.0.1:6512`, con cabeceras `Upgrade`.

Después de instalarlo, valida y recarga nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

HestiaCP puede regenerar los archivos de nginx. Para que la configuración no desaparezca, debe integrarse en una plantilla nginx personalizada de Hestia o en el mecanismo de inclusión persistente configurado para el dominio.

El puerto 6510 debe permanecer accesible para el cliente nativo. Los puertos 6511 y 6512 deben quedar locales y llegar desde Internet solamente a través de nginx.
