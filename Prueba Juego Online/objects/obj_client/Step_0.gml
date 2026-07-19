// GameMaker no garantiza un evento disconnect en clientes: controlar el timeout aquí.
if ((net.status == "connecting" || net.status == "joining")
    && current_time - net.connect_started_at > NET_CONNECT_TIMEOUT_MS) {
    net_close(net);
    net.status = "error";
    net.error = "Tiempo agotado al conectar con " + SERVER_HOST + ":" + string(SERVER_PORT);
}

if (net.status == "error" && keyboard_check_pressed(ord("R"))) {
    net.uid = -1;
    net.players = [];
    net_connect(net);
}

if (!net.session_ready) exit;

chat_input = keyboard_string;
if (string_length(chat_input) > NET_MAX_CHAT_LENGTH) {
    chat_input = string_copy(chat_input, 1, NET_MAX_CHAT_LENGTH);
    keyboard_string = chat_input;
}

if (keyboard_check_pressed(vk_enter) && string_trim(chat_input) != "") {
    if (!net_send_string(net, MSG_CHAT, chat_input)) {
        net_close(net);
        net.status = "error";
        net.error = "No se pudo enviar el mensaje. Presiona R para reconectar";
    }
    keyboard_string = "";
    chat_input = "";
}
