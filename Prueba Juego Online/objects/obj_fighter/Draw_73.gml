// Visualización de colisiones dibujada después de los sprites.
draw_set_alpha(0.32);

// Hurtbox aproximada del cuerpo.
draw_set_color(c_red);
draw_circle(x, y - 40, 26, false);

// La zona de ataque coincide con collision_circle() del jugador.
if (attack_kind != ATTACK_NONE) {
    var _hit_x = fighter_hit_x(self);
    var _hit_y = fighter_hit_y(self);
    var _hit_radius = fighter_hit_radius(self);
    draw_set_color((attack_kind == ATTACK_NORMAL) ? c_lime : c_yellow);
    draw_circle(_hit_x, _hit_y, _hit_radius, false);
}

draw_set_alpha(1);
draw_set_color(c_white);

if (bubble_timer > 0 && bubble_text != "") {
    draw_set_halign(fa_center);
    draw_set_valign(fa_bottom);
    draw_text_ext(x, y - 100, bubble_text, 16, 150);
    draw_set_halign(fa_left);
    draw_set_valign(fa_top);
}
