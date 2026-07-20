// Sin vida: sprite KO y congelado. La reaparición la maneja obj_player.
if (health <= 0) {
    hsp = 0; vsp = 0;
    stun_frames = 0; knockback_active = false;
    sprite_index = spr_goku_ko;
    image_index = 0; image_speed = 0;
    image_xscale = 2 * facing;
    exit;
}

var _was_stunned = stun_frames > 0;
if (bubble_timer > 0) bubble_timer -= 1;
if (dash_cooldown > 0) dash_cooldown -= 1;
if (guard_cooldown > 0) guard_cooldown -= 1;
if (dash_tap_timer > 0) {
    dash_tap_timer -= 1;
    if (dash_tap_timer <= 0) dash_tap_direction = 0;
}
if (_was_stunned) {
    if (knockback_active) {
        // Reparte exactamente la distancia restante entre los frames de stun.
        hsp = (knockback_target_x - x) / max(1, stun_frames);
        vsp = (knockback_target_y - y) / max(1, stun_frames);
    }
    stun_frames -= 1;
}

var _nx = clamp(x + hsp, 20, room_width - 20);
x = _nx;
var _ny = clamp(y + vsp, 48, room_height - 10);
y = _ny;
if (_was_stunned && stun_frames <= 0 && knockback_active) {
    x = clamp(knockback_target_x, 20, room_width - 20);
    y = clamp(knockback_target_y, 48, room_height - 10);
    knockback_active = false;
}

if (_was_stunned) {
    sprite_index = hurt_sprite; image_index = 0; image_xscale = 2 * facing;
} else if (dash_frames > 0) {
    sprite_index = spr_goku_vanish_sideward; image_index = 0; image_xscale = 2 * dash_direction;
    dash_frames -= 1;
} else if (turn_frames > 0) {
    sprite_index = spr_goku_vanish; image_index = 0; image_xscale = 2 * facing;
    turn_frames -= 1;
    if (turn_frames <= 0) facing = pending_facing;
} else if (guard_active) {
    sprite_index = spr_goku_guard; image_index = 0; image_xscale = 2 * facing;
} else if (ki_charging) {
    sprite_index = spr_goku_charging; image_index = 0; image_xscale = 2 * facing;
} else if (ki_casting) {
    sprite_index = ki_forward ? spr_goku_forward_blast : spr_goku_blast;
    image_index = ki_forward ? 0 : ki_blast_image;
    image_xscale = 2 * facing;
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
