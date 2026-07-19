var _event_socket = async_load[? "id"];
if (_event_socket != probe_socket) exit;

var _type = async_load[? "type"];
if (_type == network_type_non_blocking_connect) {
    if (async_load[? "succeeded"] == 1) {
        server_ping = current_time - probe_started_at;
        server_online = true;
        server_error = "";
        var _payload = buffer_create(1, buffer_fixed, 1);
        buffer_write(_payload, buffer_u8, MSG_SERVER_QUERY);
        var _frame = buffer_create(3, buffer_fixed, 1);
        buffer_write(_frame, buffer_u16, 1);
        buffer_copy(_payload, 0, 1, _frame, 2);
        network_send_raw(probe_socket, _frame, 3);
        buffer_delete(_frame);
        buffer_delete(_payload);
    } else {
        server_error = "No se pudo conectar";
        menu_close_probe(id);
    }
} else if (_type == network_type_data) {
    var _source = async_load[? "buffer"];
    var _size = async_load[? "size"];
    if (_size >= 5) {
        buffer_seek(_source, buffer_seek_start, 0);
        var _length = buffer_read(_source, buffer_u16);
        var _message = buffer_read(_source, buffer_u8);
        if (_length >= 3 && _message == MSG_SERVER_INFO) {
            server_players = buffer_read(_source, buffer_u16);
            if (_length > 3) server_name = buffer_read(_source, buffer_string);
            server_online = true;
            server_error = "";
            menu_close_probe(id);
        }
    }
} else if (_type == network_type_disconnect) {
    if (!server_online) server_error = "Servidor desconectado";
    probe_socket = -1;
}
