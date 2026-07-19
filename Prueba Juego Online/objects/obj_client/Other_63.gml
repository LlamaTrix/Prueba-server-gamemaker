if (async_load[? "id"] == name_prompt) {
    username = async_load[? "result"];
    if (is_undefined(username) || username == "") username = "Jugador" + string(irandom(999));
    show_debug_message("[cliente] nombre elegido: " + username);

    estado = "conectando";

    // conexión RAW y ASÍNCRONA: el servidor es Node.js (no otro juego de GameMaker).
    // Se usa la versión _async para que el juego NO se congele mientras conecta
    // (la versión bloqueante network_connect_raw cuelga la ventana, sobre todo
    //  al resolver un dominio). El resultado llega al evento Async Networking
    //  como network_type_non_blocking_connect.
    client = network_create_socket(network_socket_tcp);
    show_debug_message("[cliente] socket creado: " + string(client));

    var res = network_connect_raw_async(client, SERVER_IP, SERVER_PORT);
    show_debug_message("[cliente] network_connect_raw_async solicitado (ret " + string(res) + ")");

    if (res < 0) {
        estado = "error";
        error_msg = "No se pudo iniciar la conexión a " + SERVER_IP + ":" + string(SERVER_PORT);
    }
    keyboard_string = "";
}
