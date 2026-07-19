/// Cliente de red para el servidor Node.js de este repositorio.
/// Protocolo TCP raw: [u16 LE largo][u8 mensaje][datos...].

#macro SERVER_HOST "prueba.minecruz.com"
#macro SERVER_PORT 6510

#macro MSG_JOIN        1
#macro MSG_WELCOME     2
#macro MSG_PLAYER_LIST 3
#macro MSG_CHAT        4
#macro MSG_ACTIVITY    5
#macro MSG_KICK        6
#macro MSG_LEAVE       7

#macro NET_CONNECT_TIMEOUT_MS 10000
#macro NET_MAX_PAYLOAD        4096
#macro NET_MAX_CHAT_LENGTH    200

/// Vacía el acumulador sin volver a crearlo.
function net_receive_reset(_state) {
    _state.receive_size = 0;
    buffer_seek(_state.receive_buffer, buffer_seek_start, 0);
}

/// Cierra el socket actual. Es seguro llamarla más de una vez.
function net_close(_state) {
    if (_state.socket >= 0) {
        network_destroy(_state.socket);
        _state.socket = -1;
    }
    _state.tcp_connected = false;
    _state.session_ready = false;
    net_receive_reset(_state);
}

/// Inicia una conexión nueva y devuelve true si pudo arrancarla.
function net_connect(_state) {
    net_close(_state);
    _state.kicked = false;
    _state.last_activity_sent = current_time;
    _state.error = "";
    _state.status = "connecting";
    _state.connect_started_at = current_time;
    _state.socket = network_create_socket(network_socket_tcp);

    if (_state.socket < 0) {
        _state.status = "error";
        _state.error = "No se pudo crear el socket de red";
        return false;
    }

    var _result = network_connect_raw_async(_state.socket, SERVER_HOST, SERVER_PORT);
    if (_result < 0) {
        net_close(_state);
        _state.status = "error";
        _state.error = "No se pudo iniciar la conexión a " + SERVER_HOST + ":" + string(SERVER_PORT);
        return false;
    }

    show_debug_message("[red] conectando socket " + string(_state.socket) + " a " + SERVER_HOST + ":" + string(SERVER_PORT));
    return true;
}

/// Envía un payload ya construido. Devuelve false cuando falla el envío.
function net_send_payload(_state, _payload) {
    if (!_state.tcp_connected || _state.socket < 0) return false;

    var _length = buffer_tell(_payload);
    if (_length <= 0 || _length > NET_MAX_PAYLOAD) return false;

    var _frame = buffer_create(_length + 2, buffer_fixed, 1);
    buffer_seek(_frame, buffer_seek_start, 0);
    buffer_write(_frame, buffer_u16, _length);
    buffer_copy(_payload, 0, _length, _frame, 2);

    var _sent = network_send_raw(_state.socket, _frame, _length + 2);
    buffer_delete(_frame);
    return _sent >= 0;
}

/// Envía [id][string NUL].
function net_send_string(_state, _message, _text) {
    var _payload = buffer_create(64, buffer_grow, 1);
    buffer_write(_payload, buffer_u8, _message);
    buffer_write(_payload, buffer_string, _text);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

/// Envía un mensaje que solo contiene su identificador.
function net_send_empty(_state, _message) {
    var _payload = buffer_create(1, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, _message);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

/// Retira una trama completa del inicio del acumulador.
function net_consume_frame(_state, _frame_size) {
    var _remaining = _state.receive_size - _frame_size;
    if (_remaining > 0) {
        var _rest = buffer_create(_remaining, buffer_fixed, 1);
        buffer_copy(_state.receive_buffer, _frame_size, _remaining, _rest, 0);
        buffer_copy(_rest, 0, _remaining, _state.receive_buffer, 0);
        buffer_delete(_rest);
    }
    _state.receive_size = _remaining;
}

/// Interpreta un payload aislado, nunca bytes de la siguiente trama.
function net_read_payload(_state, _payload) {
    buffer_seek(_payload, buffer_seek_start, 0);
    var _message = buffer_read(_payload, buffer_u8);

    switch (_message) {
        case MSG_WELCOME:
            _state.uid = buffer_read(_payload, buffer_u16);
            _state.session_ready = true;
            _state.status = "online";
            _state.error = "";
            show_debug_message("[red] sesión aceptada; uid=" + string(_state.uid));
            break;

        case MSG_PLAYER_LIST:
            var _count = buffer_read(_payload, buffer_u16);
            _state.players = [];
            for (var i = 0; i < _count; i++) {
                array_push(_state.players, buffer_read(_payload, buffer_string));
            }
            break;

        case MSG_CHAT:
            var _author = buffer_read(_payload, buffer_string);
            var _text = buffer_read(_payload, buffer_string);
            array_push(_state.chat, _author + ": " + _text);
            while (array_length(_state.chat) > 14) array_delete(_state.chat, 0, 1);
            break;

        case MSG_KICK:
            _state.kicked = true;
            _state.status = "error";
            _state.error = buffer_read(_payload, buffer_string);
            break;

        default:
            show_debug_message("[red] mensaje desconocido: " + string(_message));
            break;
    }
}

/// Acumula un bloque TCP y procesa todas las tramas completas.
function net_receive(_state, _source, _size) {
    if (_size <= 0) return true;
    if (_state.receive_size + _size > 65536) return false;

    buffer_copy(_source, 0, _size, _state.receive_buffer, _state.receive_size);
    _state.receive_size += _size;

    while (_state.receive_size >= 2) {
        buffer_seek(_state.receive_buffer, buffer_seek_start, 0);
        var _payload_size = buffer_read(_state.receive_buffer, buffer_u16);
        if (_payload_size < 1 || _payload_size > NET_MAX_PAYLOAD) return false;
        if (_state.receive_size < _payload_size + 2) break;

        var _payload = buffer_create(_payload_size, buffer_fixed, 1);
        buffer_copy(_state.receive_buffer, 2, _payload_size, _payload, 0);
        net_read_payload(_state, _payload);
        buffer_delete(_payload);
        net_consume_frame(_state, _payload_size + 2);
    }
    return true;
}
