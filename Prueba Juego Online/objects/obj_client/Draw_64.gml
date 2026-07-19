draw_set_halign(fa_left);
draw_set_valign(fa_top);

if (net.status == "error") {
    draw_set_color(c_red);
    draw_text_ext(10, 10, net.error, 18, 380);
    draw_set_color(c_white);
    draw_text(10, 64, "R: volver al menú");
    exit;
}

if (net.status != "online") {
    draw_set_color(c_yellow);
    draw_text(10, 10, "Conectando al servidor...");
    exit;
}

// --- Overlay de KO: oscurece el juego, borde rojo degradado y contador ---
if (instance_number(obj_player) > 0) {
    var _pl_ko = instance_find(obj_player, 0);
    if (_pl_ko.is_ko) {
        var _gw = display_get_gui_width();
        var _gh = display_get_gui_height();
        // oscurecer solo el juego (esto se dibuja antes que el HUD)
        draw_set_color(c_black);
        draw_set_alpha(0.55);
        draw_rectangle(0, 0, _gw, _gh, false);
        // borde rojo degradado semitransparente (viñeta)
        var _bw = 55;
        draw_set_color(c_red);
        for (var _bi = 0; _bi < _bw; _bi++) {
            draw_set_alpha(0.55 * (1 - _bi / _bw));
            draw_rectangle(_bi, _bi, _gw - 1 - _bi, _gh - 1 - _bi, true);
        }
        draw_set_alpha(1);
        // contador de reaparición
        var _secs = max(1, ceil(_pl_ko.respawn_timer / 60));
        draw_set_halign(fa_center);
        draw_set_valign(fa_middle);
        draw_set_color(c_white);
        draw_text(_gw / 2, _gh / 2 - 12, "K.O.");
        draw_text(_gw / 2, _gh / 2 + 12, "Reapareciendo en " + string(_secs) + "...");
        draw_set_halign(fa_left);
        draw_set_valign(fa_top);
        draw_set_color(c_white);
    }
}

// HUD compacto: deja visible el mundo y los luchadores.
draw_set_color(make_color_rgb(15, 20, 28));
draw_rectangle(5, 5, 395, 48, false);
draw_set_color(c_aqua);
draw_text(10, 8, username);
draw_text(10, 27, "Jugadores: " + string(array_length(net.players)));

if (instance_number(obj_player) > 0) {
    var _player = instance_find(obj_player, 0);
    draw_set_halign(fa_right);
    draw_set_color(c_white);
    draw_text(390, 8, "Ping " + (net.ping_ms >= 0 ? string(round(net.ping_ms)) + " ms" : "-- ms"));
    draw_text(390, 27, "X " + string(round(_player.x)) + "  Y " + string(round(_player.y)));
    draw_set_halign(fa_left);
}

// ---- minimapa 100x100 en la esquina inferior izquierda ----
var _mm = 100;
var _mx = 6;
var _my = 400 - _mm - 6; // pegado abajo con un pequeño margen
draw_set_alpha(0.75);
draw_set_color(make_color_rgb(10, 14, 22));
draw_rectangle(_mx, _my, _mx + _mm, _my + _mm, false);
draw_set_alpha(1);
draw_set_color(make_color_rgb(60, 70, 90));
draw_rectangle(_mx, _my, _mx + _mm, _my + _mm, true);

// otros jugadores en rojo
for (var _i = 0; _i < instance_number(obj_remote); _i++) {
    var _r = instance_find(obj_remote, _i);
    var _rx = _mx + clamp(_r.x / room_width, 0, 1) * _mm;
    var _ry = _my + clamp(_r.y / room_height, 0, 1) * _mm;
    draw_set_color(c_red);
    draw_circle(_rx, _ry, 2.5, false);
}

// tú, en azul
if (instance_number(obj_player) > 0) {
    var _pl = instance_find(obj_player, 0);
    var _plx = _mx + clamp(_pl.x / room_width, 0, 1) * _mm;
    var _ply = _my + clamp(_pl.y / room_height, 0, 1) * _mm;
    draw_set_color(make_color_rgb(60, 140, 255));
    draw_circle(_plx, _ply, 3, false);
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
}
