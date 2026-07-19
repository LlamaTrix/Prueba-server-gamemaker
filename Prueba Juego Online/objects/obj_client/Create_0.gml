username = variable_global_exists("pending_username") ? global.pending_username : "";
game_ticket = variable_global_exists("game_ticket") ? global.game_ticket : "";
chat_input = "";
chat_open = false;

display_set_gui_size(400, 400);
if (os_browser == browser_not_a_browser) {
    window_set_size(400, 400);
    window_center();
}

net = {
    socket: -1,
    tcp_connected: false,
    session_ready: false,
    status: "waiting_name",
    error: "",
    uid: -1,
    players: [],
    chat: [],
    connect_started_at: 0,
    receive_buffer: buffer_create(2048, buffer_grow, 1),
    receive_size: 0,
    kicked: false,
    last_activity_sent: 0,
    last_position_sent: 0,
    last_sent_x: -1,
    last_sent_y: -1,
    last_sent_facing: 0,
    last_sent_dx: 0,
    last_sent_dy: 0,
    last_input_sent_at: 0,
    input_sequence: 0,
    action_sequence: 0,
    pending_inputs: [],
    player_states: {},
    last_combat_event: 0,
    ping_ms: -1,
    ping_nonce: 0,
    ping_sent_at: 0,
    last_ping_at: 0,
    tcp_host: variable_global_exists("server_tcp_host") ? global.server_tcp_host : SERVER_HOST,
    tcp_port: variable_global_exists("server_tcp_port") ? global.server_tcp_port : SERVER_PORT,
    ws_url: variable_global_exists("server_ws_url") ? global.server_ws_url : SERVER_WS_URL,
    ws_port: variable_global_exists("server_ws_port") ? global.server_ws_port : SERVER_WS_PORT
};

if (username != "" && game_ticket != "") net_connect(net);
else {
    net.status = "error";
    net.error = "Falta el ticket de acceso. Vuelve al menú.";
}
