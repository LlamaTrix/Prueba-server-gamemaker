draw_set_halign(fa_left);
draw_set_valign(fa_top);
draw_set_alpha(1);
draw_set_color(make_color_rgb(8, 12, 20));
draw_rectangle(0, 0, 400, 400, false);

draw_set_halign(fa_center);
draw_set_color(c_aqua);
draw_text(200, 24, "PRUEBA JUEGO ONLINE");

if (menu_state == MENU_AUTH || menu_state == MENU_AUTH_WAIT) {
    draw_set_color(c_white);
    draw_text(200, 58, auth_mode == "register" ? "CREAR CUENTA" : "INICIAR SESION");

    draw_set_halign(fa_left);
    draw_set_color(make_color_rgb(175, 190, 210));
    draw_text(55, 84, "Usuario");
    draw_set_color(make_color_rgb(25, 32, 44));
    draw_rectangle(55, 105, 345, 147, false);
    draw_set_color(auth_field == 0 ? c_aqua : make_color_rgb(70, 80, 95));
    draw_rectangle(55, 105, 345, 147, true);
    draw_set_color(c_white);
    draw_text(67, 117, username_input + ((auth_field == 0 && menu_state == MENU_AUTH) ? "_" : ""));

    draw_set_color(make_color_rgb(175, 190, 210));
    draw_text(55, 149, "Contrasena");
    draw_set_color(make_color_rgb(25, 32, 44));
    draw_rectangle(55, 170, 345, 212, false);
    draw_set_color(auth_field == 1 ? c_aqua : make_color_rgb(70, 80, 95));
    draw_rectangle(55, 170, 345, 212, true);
    draw_set_color(c_white);
    var _masked = string_repeat("*", string_length(password_input));
    draw_text(67, 182, _masked + ((auth_field == 1 && menu_state == MENU_AUTH) ? "_" : ""));

    draw_set_color(make_color_rgb(35, 120, 90));
    draw_rectangle(55, 240, 345, 280, false);
    draw_set_halign(fa_center);
    draw_set_color(c_white);
    draw_text(200, 251, "INICIAR SESION");

    draw_set_color(make_color_rgb(35, 75, 125));
    draw_rectangle(55, 292, 345, 332, false);
    draw_set_color(c_white);
    draw_text(200, 303, "CREAR CUENTA");

    if (menu_state == MENU_AUTH_WAIT) {
        draw_set_color(make_color_rgb(8, 12, 20));
        draw_set_alpha(0.88);
        draw_rectangle(40, 225, 360, 342, false);
        draw_set_alpha(1);
        draw_set_color(c_yellow);
        draw_text(200, 270, auth_mode == "register" ? "Creando cuenta..." : "Verificando cuenta...");
    }

} else if (menu_state == MENU_SERVERS) {
    draw_set_color(c_white);
    draw_text(200, 58, "SELECCIONA UN SERVIDOR");
    draw_set_halign(fa_left);
    draw_set_color(make_color_rgb(25, 32, 44));
    draw_rectangle(20, 112, 380, 195, false);
    draw_set_color(server_online ? c_lime : c_red);
    draw_circle(39, 137, 6, false);
    draw_set_color(c_white);
    draw_text(55, 123, server_name);
    draw_set_color(make_color_rgb(190, 205, 220));
    draw_text(55, 155, "Jugadores: " + string(server_players));
    draw_text(262, 155, "Ping: " + (server_ping >= 0 ? string(round(server_ping)) + " ms" : "-- ms"));
    if (menu_error != "") {
        draw_set_halign(fa_center);
        draw_set_color(server_online ? c_white : c_yellow);
        draw_text_ext(200, 215, menu_error, 18, 360);
    }
    draw_set_halign(fa_left);
    draw_set_color(make_color_rgb(80, 45, 55));
    draw_rectangle(10, 350, 115, 390, false);
    draw_set_color(c_white);
    draw_text(25, 361, "SALIR");
    draw_set_color(make_color_rgb(35, 90, 120));
    draw_rectangle(270, 325, 390, 365, false);
    draw_set_color(c_white);
    draw_text(282, 336, "ACTUALIZAR");

} else {
    draw_set_color(c_yellow);
    draw_text(200, 175, menu_state == MENU_TICKET_WAIT
        ? "Solicitando acceso seguro..."
        : "Conectando a la partida...");
    draw_set_color(make_color_rgb(175, 190, 210));
    draw_text(200, 205, "Tu contrasena nunca viaja al servidor de juego");
}

if (menu_error != "" && (menu_state == MENU_AUTH || menu_state == MENU_AUTH_WAIT)) {
    draw_set_halign(fa_center);
    draw_set_color(c_red);
    draw_text_ext(200, 346, menu_error, 18, 360);
}

draw_set_alpha(1);
draw_set_halign(fa_left);
