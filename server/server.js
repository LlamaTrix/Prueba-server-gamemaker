// Servidor de lobby + chat para el juego de GameMaker.
// Sin dependencias: solo el módulo net de Node.
//
// Protocolo (TCP raw, little-endian):
//   Cada trama = [u16 largo del payload][payload]
//   Payload    = [u8 idMensaje][...datos]
//   Los strings son UTF-8 terminados en NUL (igual que buffer_string de GameMaker).
//
// Mensajes:
//   1 MSG_JOIN         cliente -> servidor : string nombre
//   2 MSG_WELCOME      servidor -> cliente : u16 uid
//   3 MSG_PLAYER_LIST  servidor -> todos   : u16 cantidad, N strings
//   4 MSG_CHAT         cliente -> servidor : string texto
//                      servidor -> todos   : string nombre, string texto

const net = require('net');
const http = require('http');

const PORT = process.env.PORT ? Number(process.env.PORT) : 6510;
const HTTP_PORT = process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 6511;
const MAX_NAME_LEN = 24;
const MAX_CHAT_LEN = 200;

const MSG_JOIN = 1;
const MSG_WELCOME = 2;
const MSG_PLAYER_LIST = 3;
const MSG_CHAT = 4;

let nextUid = 1;
const clients = new Map(); // socket -> { uid, name, inbuf }

// ---------- helpers de escritura ----------

class Writer {
  constructor() { this.parts = []; }
  u8(v)  { this.parts.push(Buffer.from([v & 0xff])); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.parts.push(b); return this; }
  str(s) { this.parts.push(Buffer.from(String(s), 'utf8'), Buffer.from([0])); return this; }
  frame() {
    const payload = Buffer.concat(this.parts);
    const head = Buffer.alloc(2);
    head.writeUInt16LE(payload.length);
    return Buffer.concat([head, payload]);
  }
}

function send(socket, writer) {
  if (!socket.destroyed) socket.write(writer.frame());
}

function broadcast(writer) {
  const frame = writer.frame();
  for (const [socket, c] of clients) {
    if (c.name !== null && !socket.destroyed) socket.write(frame);
  }
}

function readString(buf, offset) {
  const end = buf.indexOf(0, offset);
  if (end === -1) return null;
  return { value: buf.toString('utf8', offset, end), next: end + 1 };
}

// ---------- lógica del juego ----------

function playerListWriter() {
  const names = [...clients.values()].filter(c => c.name !== null).map(c => c.name);
  const w = new Writer().u8(MSG_PLAYER_LIST).u16(names.length);
  for (const n of names) w.str(n);
  return w;
}

function systemChat(text) {
  broadcast(new Writer().u8(MSG_CHAT).str('[Servidor]').str(text));
}

function handleMessage(socket, payload) {
  const c = clients.get(socket);
  if (!c || payload.length < 1) return;
  const msg = payload.readUInt8(0);

  if (msg === MSG_JOIN && c.name === null) {
    const r = readString(payload, 1);
    if (!r) return;
    let name = r.value.trim().slice(0, MAX_NAME_LEN);
    if (name === '') name = 'Jugador' + c.uid;
    c.name = name;

    send(socket, new Writer().u8(MSG_WELCOME).u16(c.uid));
    broadcast(playerListWriter());
    systemChat(`${name} entró al lobby`);
    console.log(`[+] ${name} (uid ${c.uid}) entró — ${countPlayers()} en línea`);

  } else if (msg === MSG_CHAT && c.name !== null) {
    const r = readString(payload, 1);
    if (!r) return;
    const text = r.value.trim().slice(0, MAX_CHAT_LEN);
    if (text === '') return;
    broadcast(new Writer().u8(MSG_CHAT).str(c.name).str(text));
    console.log(`[chat] ${c.name}: ${text}`);
  }
}

function countPlayers() {
  return [...clients.values()].filter(c => c.name !== null).length;
}

// ---------- servidor TCP ----------

const server = net.createServer(socket => {
  socket.setNoDelay(true);
  clients.set(socket, { uid: nextUid++, name: null, inbuf: Buffer.alloc(0) });
  console.log(`[~] conexión desde ${socket.remoteAddress}`);

  socket.on('data', chunk => {
    const c = clients.get(socket);
    if (!c) return;
    if (c.name === null) {
      console.log(`[debug] primeros bytes de ${socket.remoteAddress}: ${chunk.subarray(0, 24).toString('hex')}`);
    }
    c.inbuf = Buffer.concat([c.inbuf, chunk]);
    if (c.inbuf.length > 64 * 1024) { socket.destroy(); return; } // anti-flood

    while (c.inbuf.length >= 2) {
      const len = c.inbuf.readUInt16LE(0);
      if (c.inbuf.length < 2 + len) break;
      const payload = c.inbuf.subarray(2, 2 + len);
      c.inbuf = c.inbuf.subarray(2 + len);
      handleMessage(socket, payload);
    }
  });

  const bye = () => {
    const c = clients.get(socket);
    if (!c) return;
    clients.delete(socket);
    if (c.name !== null) {
      console.log(`[-] ${c.name} se desconectó — ${countPlayers()} en línea`);
      broadcast(playerListWriter());
      systemChat(`${c.name} salió del lobby`);
    }
  };
  socket.on('close', bye);
  socket.on('error', bye);
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

// ---------- página de estado (detrás de nginx en prueba.minecruz.com) ----------

const started = Date.now();

http.createServer((req, res) => {
  const names = [...clients.values()].filter(c => c.name !== null).map(c => c.name);
  if (req.url === '/status.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ online: true, jugadores: names.length, nombres: names, desde: new Date(started).toISOString() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Servidor del juego</title>
<style>body{font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center}h1{color:#6f6}code{background:#222;padding:2px 8px;border-radius:6px}</style>
<main><h1>&#9679; Servidor en línea</h1>
<p>Jugadores conectados: <strong>${names.length}</strong></p>
<p>${names.map(n => `<code>${String(n).replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</code>`).join(' ') || '(nadie todavía)'}</p>
<p>Conéctate desde el juego a <code>prueba.minecruz.com:${PORT}</code></p></main></html>`);
}).listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`Página de estado en http://127.0.0.1:${HTTP_PORT}`);
});
