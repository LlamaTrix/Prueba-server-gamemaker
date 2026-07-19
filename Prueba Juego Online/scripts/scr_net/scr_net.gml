/// Configuración de red y protocolo de mensajes
/// El servidor es Node.js (carpeta server/ del repo). Se usan sockets RAW:
/// cada trama lleva un prefijo u16 (little-endian) con el largo del payload.

#macro SERVER_IP   "prueba.minecruz.com"
#macro SERVER_PORT 6510

// IDs de mensaje (1 byte al inicio de cada payload)
#macro MSG_JOIN        1  // cliente -> servidor: string nombre
#macro MSG_WELCOME     2  // servidor -> cliente: u16 uid asignado
#macro MSG_PLAYER_LIST 3  // servidor -> todos: u16 cantidad, luego N strings
#macro MSG_CHAT        4  // cliente -> servidor: string texto
                          // servidor -> todos: string nombre, string texto

/// Envía un payload al servidor con el prefijo u16 de largo
function net_send(_sock, _payload) {
    var _len = buffer_tell(_payload);
    var _out = buffer_create(_len + 2, buffer_fixed, 1);
    buffer_write(_out, buffer_u16, _len);
    buffer_copy(_payload, 0, _len, _out, 2);
    // OJO: network_send_raw envía desde la posición actual del buffer,
    // hay que volver al inicio para que salga el prefijo de largo
    buffer_seek(_out, buffer_seek_start, 0);
    network_send_raw(_sock, _out, _len + 2);
    buffer_delete(_out);
}

/// Atajo: envía un mensaje que consiste en [u8 id][string texto]
function net_send_string(_sock, _msg_id, _text) {
    var _b = buffer_create(64, buffer_grow, 1);
    buffer_write(_b, buffer_u8, _msg_id);
    buffer_write(_b, buffer_string, _text);
    net_send(_sock, _b);
    buffer_delete(_b);
}
