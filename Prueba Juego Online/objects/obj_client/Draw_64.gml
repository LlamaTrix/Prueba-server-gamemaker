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
    if (_player.charging) {
        var _charge_level = floor(_player.charge_frames / _player.strong_charge_step);
        draw_set_color(c_yellow);
        draw_text(10, 40, "Cargando fuerte: " + string(_player.charge_frames) + "/60  (empuje +" + string(_charge_level) + ")");
    }
}

draw_set_color(c_white);
draw_text(10, 356, "Flechas: mover   A: girar   Z: combo");
draw_text(10, 374, "X fuerte   Arr+X alto   Abj+X bajo");
