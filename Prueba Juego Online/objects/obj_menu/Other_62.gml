var _request_id = async_load[? "id"];
if (_request_id != auth_request_id
    && _request_id != servers_request_id
    && _request_id != ticket_request_id) exit;

var _status = async_load[? "status"];
if (_status == 1) exit;

var _is_auth = _request_id == auth_request_id;
var _is_servers = _request_id == servers_request_id;
var _is_ticket = _request_id == ticket_request_id;

if (_is_auth) auth_request_id = -1;
if (_is_servers) servers_request_id = -1;
if (_is_ticket) ticket_request_id = -1;

if (_status < 0) {
    menu_error = _is_auth
        ? "No hay conexion con el servidor de cuentas. Intenta de nuevo."
        : "No hay conexion con el servidor.";
    if (_is_auth) {
        menu_state = MENU_AUTH;
        menu_focus_field(id, 1);
    } else {
        menu_state = MENU_SERVERS;
        server_online = false;
    }
    exit;
}

var _http_status = async_load[? "http_status"];
var _body = async_load[? "result"];
var _data = undefined;
var _json_ok = false;
try {
    _data = json_parse(_body);
    _json_ok = is_struct(_data);
} catch (_exception) {
    _json_ok = false;
}

if (!_json_ok) {
    menu_error = "La API devolvio una respuesta invalida (HTTP " + string(_http_status) + ")";
    menu_state = _is_auth ? MENU_AUTH : MENU_SERVERS;
    if (_is_auth) menu_focus_field(id, 1);
    exit;
}

if (_http_status < 200 || _http_status >= 300) {
    if (_is_auth) {
        // Cuenta inexistente o credenciales incorrectas: mensaje claro.
        if (auth_mode == "register") {
            menu_error = (_http_status == 409)
                ? "Ese usuario ya existe. Prueba con otro nombre."
                : "No se pudo crear la cuenta. Revisa los datos.";
        } else {
            menu_error = "No tienes una cuenta o los datos son incorrectos. Crea una cuenta.";
        }
    } else {
        menu_error = variable_struct_exists(_data, "error")
            ? string(_data.error)
            : "Solicitud rechazada (HTTP " + string(_http_status) + ")";
    }
    if (_is_ticket && _http_status == 401) {
        global.auth_token = "";
        global.account_id = "";
        menu_state = MENU_AUTH;
        menu_focus_field(id, 1);
    } else {
        menu_state = _is_auth ? MENU_AUTH : MENU_SERVERS;
        if (_is_auth) menu_focus_field(id, 1);
    }
    exit;
}

if (_is_auth) {
    if (!variable_struct_exists(_data, "token")
        || !variable_struct_exists(_data, "user")
        || !is_struct(_data.user)) {
        menu_error = "Respuesta de autenticacion incompleta";
        menu_state = MENU_AUTH;
        menu_focus_field(id, 1);
        exit;
    }
    global.auth_token = string(_data.token);
    global.account_id = string(_data.user.id);
    global.pending_username = string(_data.user.username);
    username_input = global.pending_username;
    password_input = "";
    keyboard_string = "";
    menu_error = "";
    menu_state = MENU_SERVERS;
    menu_refresh_servers(id);

} else if (_is_servers) {
    if (!variable_struct_exists(_data, "servers")
        || !is_array(_data.servers)
        || array_length(_data.servers) < 1) {
        menu_error = "No hay servidores configurados";
        server_online = false;
        exit;
    }
    var _server = _data.servers[0];
    server_id = string(_server.id);
    server_name = string(_server.name);
    server_online = _server.online;
    server_players = real(_server.players);
    server_ping = max(0, current_time - request_started_at);
    menu_error = "";

    global.selected_server_id = server_id;
    global.server_tcp_host = string(_server.tcpHost);
    global.server_tcp_port = real(_server.tcpPort);
    global.server_ws_url = string(_server.wsUrl);
    global.server_ws_port = real(_server.wsPort);

} else if (_is_ticket) {
    if (!variable_struct_exists(_data, "ticket")) {
        menu_error = "El servidor no entrego un ticket de acceso";
        menu_state = MENU_SERVERS;
        exit;
    }
    global.game_ticket = string(_data.ticket);
    if (instance_number(obj_client) > 0) with (obj_client) instance_destroy();
    instance_create_depth(0, 0, 1000, obj_client);
    menu_state = MENU_CONNECTING;
    menu_error = "";
}
