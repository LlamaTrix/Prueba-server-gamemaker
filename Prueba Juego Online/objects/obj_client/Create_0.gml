username = variable_global_exists("pending_username") ? global.pending_username : "";
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
    input_sequence: 0,
    pending_inputs: [],
    player_states: {},
    ping_ms: -1,
    ping_nonce: 0,
    ping_sent_at: 0,
    last_ping_at: 0
};

if (username != "") net_connect(net);
