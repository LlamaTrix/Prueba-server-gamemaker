var _mx = device_mouse_x_to_gui(0);
var _my = device_mouse_y_to_gui(0);
var _click = mouse_check_button_pressed(mb_left);

if (menu_state == 0) {
    if (!server_online && probe_socket >= 0 && current_time - probe_started_at > 8000) {
        server_error = "Tiempo de espera agotado";
        menu_close_probe(id);
    }
    if (_click && point_in_rectangle(_mx, _my, 270, 325, 390, 365)) {
        menu_refresh_server(id);
    }
    if (_click && server_online && point_in_rectangle(_mx, _my, 20, 115, 380, 190)) {
        menu_close_probe(id);
        menu_state = 1;
        keyboard_string = "";
        username_input = "";
        name_error = "";
    }
} else if (menu_state == 1) {
    username_input = string_copy(keyboard_string, 1, 24);
    keyboard_string = username_input;
    var _submit = keyboard_check_pressed(vk_enter)
        || (_click && point_in_rectangle(_mx, _my, 110, 245, 290, 287));
    if (_submit) {
        username_input = string_trim(username_input);
        if (username_input == "") {
            name_error = "Debes escribir un nombre";
        } else {
            global.pending_username = username_input;
            if (instance_number(obj_client) == 0) instance_create_depth(0, 0, 1000, obj_client);
            menu_state = 2;
            name_error = "";
        }
    }
} else if (menu_state == 2 && instance_number(obj_client) > 0) {
    var _client = instance_find(obj_client, 0);
    if (_client.net.session_ready) {
        keyboard_string = "";
        instance_destroy();
    } else if (_client.net.status == "name_rejected") {
        name_error = _client.net.error;
        with (_client) instance_destroy();
        menu_state = 1;
        keyboard_string = username_input;
    } else if (_client.net.status == "error") {
        name_error = _client.net.error;
        with (_client) instance_destroy();
        menu_state = 1;
        keyboard_string = username_input;
    }
}
