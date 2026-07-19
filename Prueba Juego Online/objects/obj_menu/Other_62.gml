if (async_load[? "id"] == http_request_id) {
    var _status = async_load[? "status"];
    if (_status == 0) {
        server_ping = current_time - http_started_at;
        try {
            var _data = json_parse(async_load[? "result"]);
            server_online = true;
            server_error = "";
            if (variable_struct_exists(_data, "jugadores")) server_players = _data.jugadores;
        } catch (_exception) {
            server_online = false;
            server_error = "Respuesta inválida del servidor";
        }
    } else {
        server_online = false;
        server_error = "Servidor no disponible";
    }
}
