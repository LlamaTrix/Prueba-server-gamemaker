var _mx = device_mouse_x_to_gui(0);
var _my = device_mouse_y_to_gui(0);
var _click = mouse_check_button_pressed(mb_left);

if (menu_state == MENU_AUTH) {
    if (_click && point_in_rectangle(_mx, _my, 55, 105, 345, 147)) {
        menu_focus_field(id, 0);
    } else if (_click && point_in_rectangle(_mx, _my, 55, 170, 345, 212)) {
        menu_focus_field(id, 1);
    }

    if (keyboard_check_pressed(vk_tab)) {
        menu_focus_field(id, 1 - auth_field);
    }

    if (auth_field == 0) {
        username_input = string_copy(keyboard_string, 1, 24);
        keyboard_string = username_input;
    } else {
        password_input = string_copy(keyboard_string, 1, 128);
        keyboard_string = password_input;
    }

    if (keyboard_check_pressed(vk_enter)) {
        if (auth_field == 0) menu_focus_field(id, 1);
        else menu_auth_request(id, "login");
    }
    if (_click && point_in_rectangle(_mx, _my, 55, 240, 345, 280)) {
        menu_auth_request(id, "login");
    }
    if (_click && point_in_rectangle(_mx, _my, 55, 292, 345, 332)) {
        menu_auth_request(id, "register");
    }

} else if (menu_state == MENU_AUTH_WAIT) {
    if (current_time - request_started_at > 12000) {
        auth_request_id = -1;
        menu_state = MENU_AUTH;
        menu_error = "La API tardó demasiado. Intenta otra vez.";
        menu_focus_field(id, 1);
    }

} else if (menu_state == MENU_SERVERS) {
    if (servers_request_id >= 0 && current_time - request_started_at > 10000) {
        servers_request_id = -1;
        server_online = false;
        menu_error = "No respondió la lista de servidores";
    }
    if (_click && point_in_rectangle(_mx, _my, 270, 325, 390, 365)) {
        menu_refresh_servers(id);
    }
    if (_click && point_in_rectangle(_mx, _my, 10, 350, 115, 390)) {
        menu_logout(id);
    }
    if (_click && server_online && point_in_rectangle(_mx, _my, 20, 112, 380, 195)) {
        menu_request_ticket(id);
    }

} else if (menu_state == MENU_TICKET_WAIT) {
    if (current_time - request_started_at > 10000) {
        ticket_request_id = -1;
        menu_state = MENU_SERVERS;
        menu_error = "No se pudo obtener acceso a la partida";
    }

} else if (menu_state == MENU_CONNECTING && instance_number(obj_client) > 0) {
    var _client = instance_find(obj_client, 0);
    if (_client.net.session_ready) {
        global.gameplay_ready = true;
        keyboard_string = "";
        instance_destroy();
    } else if (_client.net.status == "name_rejected" || _client.net.status == "error") {
        menu_error = _client.net.error;
        with (_client) instance_destroy();
        menu_state = MENU_SERVERS;
    }
}
