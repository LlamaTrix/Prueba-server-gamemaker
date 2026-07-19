display_set_gui_size(400, 400);
menu_state = 0; // 0 servidores, 1 nombre, 2 conectando
server_name = "Servidor principal";
server_url = "https://prueba.minecruz.com/status.json";
server_online = false;
server_players = 0;
server_ping = -1;
server_error = "";
http_request_id = -1;
http_started_at = 0;
username_input = "";
name_error = "";

function menu_refresh_server(_menu) {
    _menu.server_online = false;
    _menu.server_error = "Consultando...";
    _menu.server_ping = -1;
    _menu.http_started_at = current_time;
    _menu.http_request_id = http_get(_menu.server_url);
}

menu_refresh_server(self);
