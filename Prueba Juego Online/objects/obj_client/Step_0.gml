if (!connected) exit;

// lo que el jugador va escribiendo
chat_input = keyboard_string;
if (string_length(chat_input) > 200) {
    chat_input = string_copy(chat_input, 1, 200);
    keyboard_string = chat_input;
}

// ENTER: enviar mensaje de chat
if (keyboard_check_pressed(vk_enter) && chat_input != "") {
    net_send_string(client, MSG_CHAT, chat_input);
    keyboard_string = "";
    chat_input = "";
}
