draw_set_halign(fa_left);
draw_set_valign(fa_top);

if (net.status == "error") {
    draw_set_color(c_red);
    draw_text_ext(10, 10, net.error, 18, 380);
    draw_set_color(c_white);
    draw_text(10, 64, "R: reconectar");
    exit;
}

if (net.status != "online") {
    draw_set_color(c_yellow);
    draw_text(10, 10, "Conectando al servidor...");
    exit;
}

// HUD compacto: deja visible el mundo y los luchadores.
draw_set_color(make_color_rgb(15, 20, 28));
draw_rectangle(5, 5, 395, 34, false);
draw_set_color(c_aqua);
draw_text(10, 10, username + "  |  jugadores: " + string(array_length(net.players)));

if (instance_number(obj_player) > 0) {
    var _player = instance_find(obj_player, 0);
    draw_set_halign(fa_right);
    draw_set_color(c_white);
    draw_text(390, 10, "X " + string(round(_player.x)) + "  Y " + string(round(_player.y)));
    draw_set_halign(fa_left);
}

draw_set_color(c_white);
if (chat_open) {
    draw_set_color(make_color_rgb(25, 25, 25));
    draw_rectangle(5, 352, 395, 395, false);
    draw_set_color(c_white);
    draw_text(10, 356, "CHAT (Enter enviar / Esc cancelar)");
    var _shown = chat_input;
    if (string_length(_shown) > 43) _shown = string_copy(_shown, string_length(_shown) - 42, 43);
    draw_text(10, 376, "> " + _shown + "_");
} else {
    draw_text(10, 356, "Flechas mover A girar Z combo T chat");
    draw_text(10, 374, "X fuerte  D cargar ki  C onda ki");
}
