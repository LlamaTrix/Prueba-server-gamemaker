/// Cliente de red para el servidor Node.js de este repositorio.
/// Protocolo TCP raw: [u16 LE largo][u8 mensaje][datos...].

// Escritorio (.exe): TCP raw directo al servidor Node.
#macro SERVER_HOST "prueba.minecruz.com"
#macro SERVER_PORT 6510
// Navegador (HTML5): WebSocket seguro a través de nginx/Cloudflare.
// El navegador no permite TCP raw; GameMaker usa network_socket_wss.
#macro SERVER_WS_URL  "wss://jugar.minecruz.com/ws/"
#macro SERVER_WS_PORT 443

#macro MSG_JOIN        1
#macro MSG_WELCOME     2
#macro MSG_PLAYER_LIST 3
#macro MSG_CHAT        4
#macro MSG_ACTIVITY    5
#macro MSG_KICK        6
#macro MSG_LEAVE       7
#macro MSG_WORLD       8
#macro MSG_POS         9
#macro MSG_BUBBLE      10
#macro MSG_ATTACK      11
#macro MSG_HIT         12
#macro MSG_ATTACK_STATE 13
#macro MSG_STATS        14
#macro MSG_KI_CHARGE    15
#macro MSG_KI_FIRE      16
#macro MSG_KI_STATE     17
#macro MSG_DASH         18
#macro MSG_DASH_STATE   19
#macro MSG_KI_HIT       20
#macro MSG_INPUT        21
#macro MSG_SNAPSHOT     22
#macro MSG_PING         23
#macro MSG_PONG         24
#macro MSG_NAME_REJECT  25
#macro MSG_SERVER_QUERY 26
#macro MSG_SERVER_INFO  27

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
    with (obj_remote) instance_destroy();
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

    // En el navegador (HTML5) no existen sockets TCP: se usa WebSocket seguro.
    var _is_browser = (os_browser != browser_not_a_browser);
    if (_is_browser) {
        _state.socket = network_create_socket(network_socket_wss);
    } else {
        _state.socket = network_create_socket(network_socket_tcp);
    }

    if (_state.socket < 0) {
        _state.status = "error";
        _state.error = "No se pudo crear el socket de red";
        return false;
    }

    var _host = _is_browser ? SERVER_WS_URL : SERVER_HOST;
    var _port = _is_browser ? SERVER_WS_PORT : SERVER_PORT;
    var _result = network_connect_raw_async(_state.socket, _host, _port);
    if (_result < 0) {
        net_close(_state);
        _state.status = "error";
        _state.error = "No se pudo iniciar la conexión a " + string(_host) + ":" + string(_port);
        return false;
    }

    show_debug_message("[red] conectando socket " + string(_state.socket) + " a " + string(_host) + ":" + string(_port));
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

function net_send_position(_state, _x, _y, _facing) {
    var _payload = buffer_create(6, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, MSG_POS);
    buffer_write(_payload, buffer_u16, clamp(round(_x), 0, 65535));
    buffer_write(_payload, buffer_u16, clamp(round(_y), 0, 65535));
    buffer_write(_payload, buffer_s8, _facing);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

function net_send_attack(_state, _kind, _charge_level, _combo_stage) {
    var _payload = buffer_create(4, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, MSG_ATTACK);
    buffer_write(_payload, buffer_u8, _kind);
    buffer_write(_payload, buffer_u8, clamp(_charge_level, 0, 3));
    buffer_write(_payload, buffer_u8, clamp(_combo_stage, 0, 3));
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

function net_send_ki_charge(_state, _active) {
    var _payload = buffer_create(2, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, MSG_KI_CHARGE);
    buffer_write(_payload, buffer_u8, _active ? 1 : 0);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

function net_send_ki_fire(_state, _forward) {
    var _payload = buffer_create(2, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, MSG_KI_FIRE);
    buffer_write(_payload, buffer_u8, _forward ? 1 : 0);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

function net_send_dash(_state, _direction) {
    var _payload = buffer_create(2, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, MSG_DASH);
    buffer_write(_payload, buffer_s8, _direction);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

/// Reporta que nuestra onda de ki impactó a un jugador. El servidor valida y aplica daño.
function net_send_ki_hit(_state, _target_uid) {
    var _payload = buffer_create(3, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, MSG_KI_HIT);
    buffer_write(_payload, buffer_u16, _target_uid);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

function net_send_input(_state, _sequence, _dx, _dy, _facing) {
    var _payload = buffer_create(8, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, MSG_INPUT);
    buffer_write(_payload, buffer_u32, _sequence);
    buffer_write(_payload, buffer_s8, _dx);
    buffer_write(_payload, buffer_s8, _dy);
    buffer_write(_payload, buffer_s8, _facing);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

function net_send_ping(_state, _nonce) {
    var _payload = buffer_create(5, buffer_fixed, 1);
    buffer_write(_payload, buffer_u8, MSG_PING);
    buffer_write(_payload, buffer_u32, _nonce);
    var _ok = net_send_payload(_state, _payload);
    buffer_delete(_payload);
    return _ok;
}

function net_find_remote(_uid) {
    for (var i = 0; i < instance_number(obj_remote); i++) {
        var _remote = instance_find(obj_remote, i);
        if (_remote.remote_uid == _uid) return _remote;
    }
    return noone;
}

function net_set_bubble(_uid, _text) {
    if (instance_number(obj_player) > 0) {
        var _local = instance_find(obj_player, 0);
        if (_local.net_uid == _uid) {
            _local.bubble_text = _text;
            _local.bubble_timer = 240;
            return;
        }
    }
    var _remote = net_find_remote(_uid);
    if (_remote != noone) {
        _remote.bubble_text = _text;
        _remote.bubble_timer = 240;
    }
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
            // Compatibilidad: el servidor antiguo enviaba únicamente el UID (3 bytes).
            // El protocolo nuevo añade X/Y y tiene 7 bytes en total.
            var _has_spawn = buffer_get_size(_payload) >= 7;
            var _spawn_x = -1;
            var _spawn_y = -1;
            if (_has_spawn) {
                _spawn_x = buffer_read(_payload, buffer_u16);
                _spawn_y = buffer_read(_payload, buffer_u16);
            }
            if (instance_number(obj_player) > 0) {
                var _player = instance_find(obj_player, 0);
                _player.net_uid = _state.uid;
                if (_has_spawn) {
                    _player.x = _spawn_x;
                    _player.y = _spawn_y;
                }
            }
            _state.session_ready = true;
            _state.status = "online";
            _state.error = "";
            show_debug_message("[red] sesión aceptada; uid=" + string(_state.uid));
            break;

        case MSG_WORLD:
            with (obj_remote) instance_destroy();
            var _world_count = buffer_read(_payload, buffer_u16);
            for (var _wi = 0; _wi < _world_count; _wi++) {
                var _uid = buffer_read(_payload, buffer_u16);
                var _name = buffer_read(_payload, buffer_string);
                var _x = buffer_read(_payload, buffer_u16);
                var _y = buffer_read(_payload, buffer_u16);
                var _facing = buffer_read(_payload, buffer_s8);
                if (_uid != _state.uid) {
                    var _remote = instance_create_layer(_x, _y, "Instances", obj_remote);
                    _remote.remote_uid = _uid;
                    _remote.remote_name = _name;
                    _remote.target_x = _x;
                    _remote.target_y = _y;
                    _remote.facing = _facing;
                }
            }
            break;

        case MSG_POS:
            var _pos_uid = buffer_read(_payload, buffer_u16);
            var _pos_x = buffer_read(_payload, buffer_u16);
            var _pos_y = buffer_read(_payload, buffer_u16);
            var _pos_facing = buffer_read(_payload, buffer_s8);
            if (_pos_uid != _state.uid) {
                var _pos_remote = net_find_remote(_pos_uid);
                if (_pos_remote != noone) {
                    _pos_remote.target_x = _pos_x;
                    _pos_remote.target_y = _pos_y;
                    _pos_remote.facing = _pos_facing;
                }
            }
            break;

        case MSG_BUBBLE:
            var _bubble_uid = buffer_read(_payload, buffer_u16);
            var _bubble_text = buffer_read(_payload, buffer_string);
            net_set_bubble(_bubble_uid, _bubble_text);
            break;

        case MSG_HIT:
            var _hit_uid = buffer_read(_payload, buffer_u16);
            var _hit_kind = buffer_read(_payload, buffer_u8);
            var _hit_direction = buffer_read(_payload, buffer_s8);
            var _hit_charge = buffer_read(_payload, buffer_u8);
            // El protocolo web incluye la vida resultante en la misma trama del
            // impacto. Con servidores antiguos se calcula localmente como respaldo.
            var _hit_has_health = buffer_get_size(_payload) >= 7;
            var _hit_health = -1;
            if (_hit_has_health) _hit_health = buffer_read(_payload, buffer_u8);
            var _hit_has_position = buffer_get_size(_payload) >= 11;
            var _hit_x = -1;
            var _hit_y = -1;
            if (_hit_has_position) {
                _hit_x = buffer_read(_payload, buffer_u16);
                _hit_y = buffer_read(_payload, buffer_u16);
            }
            var _hit_target = noone;
            if (_hit_uid == _state.uid && instance_number(obj_player) > 0) {
                _hit_target = instance_find(obj_player, 0);
            } else {
                _hit_target = net_find_remote(_hit_uid);
            }
            if (_hit_target != noone) {
                if (_hit_has_health) {
                    _hit_target.health = _hit_health;
                } else {
                    var _hit_damage = 3;
                    if (_hit_kind != ATTACK_NORMAL) _hit_damage = 5 + _hit_charge;
                    _hit_target.health = max(0, _hit_target.health - _hit_damage);
                }
                if (_hit_kind != ATTACK_NORMAL) fighter_spawn_explosion(_hit_target.x, _hit_target.y - 40);
                fighter_receive_hit(_hit_target, _hit_kind, _hit_direction, _hit_charge, _hit_x, _hit_y);
            }
            break;

        case MSG_ATTACK_STATE:
            var _attacker_uid = buffer_read(_payload, buffer_u16);
            var _attacker_kind = buffer_read(_payload, buffer_u8);
            var _attacker_stage = buffer_read(_payload, buffer_u8);
            if (_attacker_uid != _state.uid) {
                var _attacker = net_find_remote(_attacker_uid);
                if (_attacker != noone) {
                    _attacker.attack_kind = _attacker_kind;
                    _attacker.combo_stage = _attacker_stage;
                    switch (_attacker_stage) {
                        case 1:
                            _attacker.combo_timer = _attacker.combo_duration_1;
                            break;
                        case 2:
                            _attacker.combo_timer = _attacker.combo_duration_2;
                            break;
                        case 3:
                            _attacker.combo_timer = _attacker.combo_duration_3;
                            break;
                        default:
                            _attacker.combo_timer = _attacker.strong_duration;
                            break;
                    }
                    _attacker.combo_hit = true;
                }
            }
            break;

        case MSG_STATS:
            var _stats_uid = buffer_read(_payload, buffer_u16);
            var _stats_health = buffer_read(_payload, buffer_u8);
            var _stats_ki = buffer_read(_payload, buffer_u8);
            var _stats_target = noone;
            if (_stats_uid == _state.uid && instance_number(obj_player) > 0) {
                _stats_target = instance_find(obj_player, 0);
            } else {
                _stats_target = net_find_remote(_stats_uid);
            }
            if (_stats_target != noone) {
                _stats_target.health = _stats_health;
                _stats_target.ki = _stats_ki;
            }
            break;

        case MSG_KI_STATE:
            var _ki_uid = buffer_read(_payload, buffer_u16);
            var _ki_state = buffer_read(_payload, buffer_u8);
            if (_ki_uid != _state.uid) {
                var _ki_remote = net_find_remote(_ki_uid);
                if (_ki_remote != noone) {
                    _ki_remote.ki_charging = _ki_state == 1;
                    if (_ki_state == 2 || _ki_state == 3) {
                        _ki_remote.ki_casting = true;
                        _ki_remote.ki_forward = _ki_state == 3;
                        _ki_remote.ki_cast_timer = (_ki_state == 3) ? 10 : 20;
                        _ki_remote.ki_blast_image = 1;
                        fighter_spawn_ki_blast(_ki_remote);
                    }
                }
            }
            break;

        case MSG_DASH_STATE:
            var _dash_uid = buffer_read(_payload, buffer_u16);
            var _dash_x = buffer_read(_payload, buffer_u16);
            var _dash_y = buffer_read(_payload, buffer_u16);
            var _dash_direction = buffer_read(_payload, buffer_s8);
            // Nuestro propio personaje es autoridad local: el eco de nuestro dash
            // se ignora (igual que el ki), para que el vanish no se vea dos veces.
            if (_dash_uid != _state.uid) {
                var _dash_remote = net_find_remote(_dash_uid);
                if (_dash_remote != noone) {
                    _dash_remote.target_x = _dash_x;
                    _dash_remote.target_y = _dash_y;
                    _dash_remote.dash_direction = _dash_direction;
                    _dash_remote.dash_frames = _dash_remote.dash_visual_frames;
                }
            }
            break;

        case MSG_SNAPSHOT:
            var _snap_uid = buffer_read(_payload, buffer_u16);
            var _snap_sequence = buffer_read(_payload, buffer_u32);
            var _snap_x = buffer_read(_payload, buffer_u16);
            var _snap_y = buffer_read(_payload, buffer_u16);
            var _snap_facing = buffer_read(_payload, buffer_s8);
            if (_snap_uid == _state.uid && instance_number(obj_player) > 0) {
                var _snap_player = instance_find(obj_player, 0);
                var _replay_x = _snap_x;
                var _replay_y = _snap_y;
                var _pending_new = [];
                for (var _pi = 0; _pi < array_length(_state.pending_inputs); _pi++) {
                    var _input = _state.pending_inputs[_pi];
                    if (_input.sequence > _snap_sequence) {
                        var _input_len = point_distance(0, 0, _input.dx, _input.dy);
                        if (_input_len > 0) {
                            _replay_x += _input.dx / _input_len * _snap_player.move_speed;
                            _replay_y += _input.dy / _input_len * _snap_player.move_speed;
                        }
                        array_push(_pending_new, _input);
                    }
                }
                _state.pending_inputs = _pending_new;
                _snap_player.net_correction_x = _replay_x - _snap_player.x;
                _snap_player.net_correction_y = _replay_y - _snap_player.y;
            } else {
                var _snap_remote = net_find_remote(_snap_uid);
                if (_snap_remote != noone) {
                    _snap_remote.target_x = _snap_x;
                    _snap_remote.target_y = _snap_y;
                    _snap_remote.facing = _snap_facing;
                }
            }
            break;

        case MSG_PONG:
            var _pong_nonce = buffer_read(_payload, buffer_u32);
            if (_pong_nonce == _state.ping_nonce) {
                _state.ping_ms = max(0, current_time - _state.ping_sent_at);
            }
            break;

        case MSG_NAME_REJECT:
            _state.status = "name_rejected";
            _state.error = buffer_read(_payload, buffer_string);
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
