display_set_gui_size(400, 400);
menu_state = 0;
server_name = "Servidor principal";
server_online = false;
server_players = 0;
server_ping = -1;
server_error = "Consultando...";
probe_socket = -1;
probe_started_at = 0;
username_input = "";
name_error = "";

function menu_close_probe(_menu) {
    if (_menu.probe_socket >= 0) {
        network_destroy(_menu.probe_socket);
        _menu.probe_socket = -1;
    }
}

function menu_refresh_server(_menu) {
    menu_close_probe(_menu);
    _menu.server_online = false;
    _menu.server_players = 0;
    _menu.server_ping = -1;
    _menu.server_error = "Consultando...";
    _menu.probe_started_at = current_time;
    var _browser = os_browser != browser_not_a_browser;
    _menu.probe_socket = network_create_socket(_browser ? network_socket_wss : network_socket_tcp);
    if (_menu.probe_socket < 0) {
        _menu.server_error = "No se pudo crear la conexión";
        return;
    }
    var _host = _browser ? SERVER_WS_URL : SERVER_HOST;
    var _port = _browser ? SERVER_WS_PORT : SERVER_PORT;
    if (network_connect_raw_async(_menu.probe_socket, _host, _port) < 0) {
        menu_close_probe(_menu);
        _menu.server_error = "Servidor no disponible";
    }
}

menu_refresh_server(id);
