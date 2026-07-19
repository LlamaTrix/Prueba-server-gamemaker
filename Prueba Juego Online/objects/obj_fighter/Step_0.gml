var _was_stunned = stun_frames > 0;
if (bubble_timer > 0) bubble_timer -= 1;
if (_was_stunned) {
    stun_frames -= 1;
    hsp = knockback_x; vsp = knockback_y;
    knockback_x *= 0.82; knockback_y *= 0.82;
}

var _nx = clamp(x + hsp, 20, room_width - 20);
x = _nx;
var _ny = clamp(y + vsp, 48, room_height - 10);
y = _ny;

if (_was_stunned) {
    sprite_index = hurt_sprite; image_index = 0; image_xscale = 2 * facing;
} else if (turn_frames > 0) {
    sprite_index = spr_goku_vanish; image_index = 0; image_xscale = 2 * facing;
    turn_frames -= 1;
    if (turn_frames <= 0) facing = pending_facing;
} else if (charging) {
    switch (charge_kind) {
        case ATTACK_STRONG: sprite_index = spr_goku_strong; break;
        case ATTACK_STRONG_HIGH: sprite_index = spr_goku_strong_high; break;
        case ATTACK_STRONG_LOW: sprite_index = spr_goku_strong_low; break;
    }
    image_index = 0; image_xscale = 2 * facing;
} else if (attack_kind != ATTACK_NONE) {
    switch (attack_kind) {
        case ATTACK_NORMAL:
        case ATTACK_STRONG:
            if (combo_stage > 0) { sprite_index = spr_goku_combo; image_index = combo_stage - 1; }
            else { sprite_index = spr_goku_strong; image_index = 1; }
            break;
        case ATTACK_STRONG_HIGH:
            sprite_index = spr_goku_strong_high; image_index = 1;
            break;
        case ATTACK_STRONG_LOW:
            sprite_index = spr_goku_strong_low; image_index = 1;
            break;
    }
    image_xscale = 2 * facing;
} else if (abs(hsp) > 0.01 || abs(vsp) > 0.01) {
    // Ambos recursos originales miran a la derecha: facing controla siempre el volteo.
    // Se usa backward únicamente cuando el desplazamiento horizontal va contra la mirada.
    var _moving_backward = abs(hsp) > 0.01 && sign(hsp) != facing;
    sprite_index = _moving_backward ? spr_goku_backward : spr_goku_forward;
    image_index = 0;
    image_xscale = 2 * facing;
} else {
    sprite_index = spr_goku; image_index = 0; image_xscale = 2 * facing;
}

image_speed = 0; hsp = 0; vsp = 0;
