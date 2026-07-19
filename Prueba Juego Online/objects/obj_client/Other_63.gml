if (async_load[? "id"] == name_prompt) {
    username = async_load[? "result"];
    if (is_undefined(username) || username == "") username = "Jugador" + string(irandom(999));
    show_debug_message("[cliente] nombre elegido: " + username);

    estado = "conectando";

    // conexión RAW: el servidor es Node.js, no otro juego de GameMaker
    client = network_create_socket(network_socket_tcp);
    show_debug_message("[cliente] socket creado: " + string(client));

    var res = network_connect_raw(client, SERVER_IP, SERVER_PORT);
    show_debug_message("[cliente] network_connect_raw devolvió: " + string(res));

    if (res < 0) {
        estado = "error";
        error_msg = "No se pudo conectar a " + SERVER_IP + ":" + string(SERVER_PORT)
                  + "  (codigo " + string(res) + ")";
    } else {
        connected = true;
        estado = "conectado";
        net_send_string(client, MSG_JOIN, username);
        show_debug_message("[cliente] MSG_JOIN enviado, esperando WELCOME...");
        keyboard_string = "";
    }
}
