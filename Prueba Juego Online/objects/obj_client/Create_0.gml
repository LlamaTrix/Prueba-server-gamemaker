username = "";
chat_input = "";
chat_open = false;
name_prompt = -1;

// La interfaz usa una superficie lógica fija de 400 x 400.
display_set_gui_size(400, 400);
window_set_size(400, 400);
window_center();

// Todo el estado mutable de red vive aquí; los eventos solo lo orquestan.
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
    last_sent_facing: 0
};

show_debug_message("[cliente] solicitando nombre...");
name_prompt = get_string_async("Escribe tu nombre de usuario:", "Jugador");
