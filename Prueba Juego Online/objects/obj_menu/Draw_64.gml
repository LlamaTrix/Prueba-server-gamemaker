draw_set_halign(fa_left);
draw_set_valign(fa_top);
draw_set_alpha(1);
draw_set_color(make_color_rgb(8, 12, 20));
draw_rectangle(0, 0, 400, 400, false);

draw_set_color(c_aqua);
draw_set_halign(fa_center);
draw_text(200, 28, "PRUEBA JUEGO ONLINE");

if (menu_state == 0) {
    draw_set_color(c_white);
    draw_text(200, 65, "1. Selecciona un servidor");
    draw_set_halign(fa_left);
    draw_set_color(make_color_rgb(25, 32, 44));
    draw_rectangle(20, 115, 380, 190, false);
    draw_set_color(server_online ? c_lime : c_red);
    draw_circle(38, 137, 6, false);
    draw_set_color(c_white);
    draw_text(54, 124, server_name);
    draw_set_color(make_color_rgb(190, 205, 220));
    draw_text(54, 151, "Jugadores: " + string(server_players));
    var _server_ping_text = server_ping >= 0 ? string(round(server_ping)) + " ms" : "-- ms";
    draw_text(260, 151, "Ping: " + _server_ping_text);
    if (!server_online) {
        draw_set_color(c_yellow);
        draw_text(25, 205, server_error);
    }
    draw_set_color(make_color_rgb(35, 90, 120));
    draw_rectangle(270, 325, 390, 365, false);
    draw_set_color(c_white);
    draw_set_halign(fa_center);
    draw_text(330, 336, "ACTUALIZAR");
} else if (menu_state == 1) {
    draw_set_color(c_white);
    draw_text(200, 65, "2. Elige tu nombre");
    draw_set_halign(fa_left);
    draw_set_color(make_color_rgb(25, 32, 44));
    draw_rectangle(55, 145, 345, 190, false);
    draw_set_color(c_white);
    draw_text(67, 158, username_input + "_");
    draw_set_color(make_color_rgb(35, 120, 90));
    draw_rectangle(110, 245, 290, 287, false);
    draw_set_color(c_white);
    draw_set_halign(fa_center);
    draw_text(200, 257, "ENTRAR AL LOBBY");
    if (name_error != "") {
        draw_set_color(c_red);
        draw_text(200, 305, name_error);
    }
} else {
    draw_set_color(c_yellow);
    draw_text(200, 185, "Conectando y verificando nombre...");
}

draw_set_halign(fa_left);
