if (async_load[? "id"] == name_prompt) {
    username = async_load[? "result"];
    if (is_undefined(username) || username == "") username = "Jugador" + string(irandom(999));

    // conexión RAW: el servidor es Node.js, no otro juego de GameMaker
    client = network_create_socket(network_socket_tcp);
    var res = network_connect_raw(client, SERVER_IP, SERVER_PORT);
    if (res < 0) {
        error_msg = "No se pudo conectar a " + SERVER_IP + ":" + string(SERVER_PORT);
    } else {
        connected = true;
        net_send_string(client, MSG_JOIN, username);
        keyboard_string = "";
    }
}
