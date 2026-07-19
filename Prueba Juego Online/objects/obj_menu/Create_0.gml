display_set_gui_size(400, 400);

MENU_AUTH = 0;
MENU_AUTH_WAIT = 1;
MENU_SERVERS = 2;
MENU_TICKET_WAIT = 3;
MENU_CONNECTING = 4;

if (!variable_global_exists("auth_token")) global.auth_token = "";
if (!variable_global_exists("account_id")) global.account_id = "";
if (!variable_global_exists("pending_username")) global.pending_username = "";
if (!variable_global_exists("game_ticket")) global.game_ticket = "";
global.gameplay_ready = false;

menu_state = (global.auth_token != "") ? MENU_SERVERS : MENU_AUTH;
auth_field = 0;
auth_mode = "login";
username_input = global.pending_username;
password_input = "";
menu_error = "";

auth_request_id = -1;
servers_request_id = -1;
ticket_request_id = -1;
request_started_at = 0;

server_id = "principal";
server_name = "Servidor principal";
server_online = false;
server_players = 0;
server_ping = -1;

function menu_focus_field(_menu, _field) {
    _menu.auth_field = _field;
    keyboard_string = (_field == 0) ? _menu.username_input : _menu.password_input;
}

function menu_auth_request(_menu, _mode) {
    _menu.username_input = string_trim(_menu.username_input);
    if (_menu.username_input == "") {
        _menu.menu_error = "Escribe tu usuario";
        return;
    }
    if (string_length(_menu.password_input) < 8) {
        _menu.menu_error = "La contraseña necesita al menos 8 caracteres";
        return;
    }

    var _headers = ds_map_create();
    ds_map_add(_headers, "Content-Type", "application/json");
    ds_map_add(_headers, "Accept", "application/json");
    var _body = json_stringify({
        username: _menu.username_input,
        password: _menu.password_input
    });
    _menu.auth_mode = _mode;
    _menu.auth_request_id = http_request(
        AUTH_API_BASE + "/auth/" + _mode, "POST", _headers, _body);
    ds_map_destroy(_headers);

    _menu.password_input = "";
    keyboard_string = "";
    if (_menu.auth_request_id < 0) {
        _menu.menu_error = "No se pudo iniciar la solicitud HTTPS";
        _menu.menu_state = _menu.MENU_AUTH;
    } else {
        _menu.menu_error = "";
        _menu.menu_state = _menu.MENU_AUTH_WAIT;
        _menu.request_started_at = current_time;
    }
}

function menu_refresh_servers(_menu) {
    _menu.server_online = false;
    _menu.server_players = 0;
    _menu.server_ping = -1;
    _menu.menu_error = "Consultando servidores...";
    _menu.request_started_at = current_time;
    var _headers = ds_map_create();
    ds_map_add(_headers, "Accept", "application/json");
    _menu.servers_request_id = http_request(
        AUTH_API_BASE + "/servers", "GET", _headers, "");
    ds_map_destroy(_headers);
    if (_menu.servers_request_id < 0) _menu.menu_error = "No se pudo consultar el servidor";
}

function menu_request_ticket(_menu) {
    if (global.auth_token == "") {
        _menu.menu_state = _menu.MENU_AUTH;
        _menu.menu_error = "Tu sesión venció. Inicia sesión nuevamente.";
        return;
    }
    var _headers = ds_map_create();
    ds_map_add(_headers, "Content-Type", "application/json");
    ds_map_add(_headers, "Accept", "application/json");
    ds_map_add(_headers, "Authorization", "Bearer " + global.auth_token);
    _menu.ticket_request_id = http_request(
        AUTH_API_BASE + "/game-ticket", "POST", _headers,
        json_stringify({ serverId: _menu.server_id }));
    ds_map_destroy(_headers);
    if (_menu.ticket_request_id < 0) {
        _menu.menu_error = "No se pudo pedir acceso a la partida";
        return;
    }
    _menu.menu_state = _menu.MENU_TICKET_WAIT;
    _menu.menu_error = "";
    _menu.request_started_at = current_time;
}

function menu_logout(_menu) {
    _menu.auth_request_id = -1;
    _menu.servers_request_id = -1;
    _menu.ticket_request_id = -1;
    global.auth_token = "";
    global.account_id = "";
    global.pending_username = "";
    global.game_ticket = "";
    _menu.username_input = "";
    _menu.password_input = "";
    _menu.menu_error = "";
    _menu.menu_state = _menu.MENU_AUTH;
    menu_focus_field(_menu, 0);
}

if (menu_state == MENU_SERVERS) menu_refresh_servers(id);
else menu_focus_field(id, 0);
