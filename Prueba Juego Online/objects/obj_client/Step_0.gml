if ((net.status == "connecting" || net.status == "joining")
    && current_time - net.connect_started_at > NET_CONNECT_TIMEOUT_MS) {
    net_close(net);
    net.status = "error";
    net.error = "Tiempo agotado al conectar con " + SERVER_HOST + ":" + string(SERVER_PORT);
}

if (net.status == "error" && keyboard_check_pressed(ord("R"))) {
    global.gameplay_ready = false;
    if (instance_number(obj_menu) == 0) instance_create_depth(0, 0, -100000, obj_menu);
    instance_destroy();
    exit;
}

if (!net.session_ready) exit;

if (current_time - net.last_ping_at >= 1000) {
    net.ping_nonce += 1;
    net.ping_sent_at = current_time;
    net.last_ping_at = current_time;
    net_send_ping(net, net.ping_nonce);
}

if (!chat_open && keyboard_check_pressed(ord("T"))) {
    chat_open = true;
    keyboard_string = "";
    chat_input = "";
}

if (chat_open) {
    chat_input = keyboard_string;
    if (string_length(chat_input) > NET_MAX_CHAT_LENGTH) {
        chat_input = string_copy(chat_input, 1, NET_MAX_CHAT_LENGTH);
        keyboard_string = chat_input;
    }

    if (keyboard_check_pressed(vk_escape)) {
        chat_open = false;
        keyboard_string = "";
        chat_input = "";
    } else if (keyboard_check_pressed(vk_enter)) {
        if (string_trim(chat_input) != "") net_send_string(net, MSG_CHAT, chat_input);
        chat_open = false;
        keyboard_string = "";
        chat_input = "";
    }
}
