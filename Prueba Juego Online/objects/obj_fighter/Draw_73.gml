// Vida: fondo gris y color según porcentaje restante.
var _bar_left = x - 30;
var _bar_right = x + 30;
draw_set_color(make_color_rgb(38, 38, 38));
draw_rectangle(_bar_left, y - 116, _bar_right, y - 109, false);
var _health_color = c_red;
if (health > 50) _health_color = c_lime;
else if (health > 20) _health_color = c_yellow;
draw_set_color(_health_color);
draw_rectangle(_bar_left, y - 116, _bar_left + 60 * clamp(health / 100, 0, 1), y - 109, false);

// Ki: fondo gris oscuro y relleno celeste.
draw_set_color(make_color_rgb(38, 38, 38));
draw_rectangle(_bar_left, y - 106, _bar_right, y - 99, false);
draw_set_color(c_aqua);
draw_rectangle(_bar_left, y - 106, _bar_left + 60 * clamp(ki / 100, 0, 1), y - 99, false);

draw_set_color(c_white);

if (bubble_timer > 0 && bubble_text != "") {
    draw_set_halign(fa_center);
    draw_set_valign(fa_bottom);
    draw_text_ext(x, y - 122, bubble_text, 16, 150);
    draw_set_halign(fa_left);
    draw_set_valign(fa_top);
}
