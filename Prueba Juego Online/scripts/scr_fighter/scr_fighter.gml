#macro ATTACK_NONE        0
#macro ATTACK_NORMAL      1
#macro ATTACK_STRONG      2
#macro ATTACK_STRONG_HIGH 3
#macro ATTACK_STRONG_LOW  4

/// Posición y tamaño únicos para dibujo y detección de las hitboxes.
function fighter_hit_x(_f) {
    var _reach = (_f.attack_kind == ATTACK_STRONG_HIGH || _f.attack_kind == ATTACK_STRONG_LOW) ? 32 : 42;
    return _f.x + _f.facing * _reach;
}

function fighter_hit_y(_f) {
    if (_f.attack_kind == ATTACK_STRONG_HIGH) return _f.y - 62;
    if (_f.attack_kind == ATTACK_STRONG_LOW) return _f.y - 18;
    return _f.y - 40;
}

function fighter_hit_radius(_f) {
    return (_f.attack_kind == ATTACK_NORMAL) ? 15 : 19;
}

function fighter_init(_f) {
    // Duraciones editables, expresadas en frames del juego.
    _f.combo_duration_1 = 20;
    _f.combo_duration_2 = 20;
    _f.combo_duration_3 = 30;
    _f.combo_input_after = 10;
    _f.strong_duration = 30;
    _f.strong_charge_max = 60;
    _f.strong_charge_step = 10;
    _f.strong_base_push = 8;
    _f.strong_charge_push_bonus = 2;

    _f.move_speed = 2.5;
    _f.hsp = 0; _f.vsp = 0; _f.facing = 1;
    _f.stun_frames = 0; _f.knockback_x = 0; _f.knockback_y = 0;
    _f.hurt_sprite = spr_goku_hurted;
    _f.attack_kind = ATTACK_NONE;
    _f.charging = false; _f.charge_kind = ATTACK_NONE; _f.charge_frames = 0;
    _f.attack_charge_level = 0;
    _f.combo_stage = 0; _f.combo_timer = 0; _f.combo_queued = false; _f.combo_hit = false;
    _f.turn_frames = 0; _f.pending_facing = 1;
    _f.bubble_text = ""; _f.bubble_timer = 0;
    _f.remote_controlled = false;
    _f.image_speed = 0; _f.image_xscale = 2; _f.image_yscale = 2;
}

function fighter_receive_hit(_target, _kind, _direction, _charge_level) {
    if (!instance_exists(_target)) return;
    _target.attack_kind = ATTACK_NONE;
    _target.charging = false; _target.charge_kind = ATTACK_NONE; _target.charge_frames = 0;
    _target.combo_stage = 0; _target.combo_timer = 0; _target.combo_queued = false;
    _target.turn_frames = 0;
    _target.hsp = 0; _target.vsp = 0;
    _target.knockback_x = 0; _target.knockback_y = 0;

    switch (_kind) {
        case ATTACK_NORMAL:
            _target.hurt_sprite = spr_goku_hurted;
            _target.stun_frames = 12;
            break;
        case ATTACK_STRONG:
            _target.hurt_sprite = spr_goku_sideward_hurt;
            _target.stun_frames = 18;
            _target.knockback_x = _direction * (_target.strong_base_push + _charge_level);
            break;
        case ATTACK_STRONG_HIGH:
            _target.hurt_sprite = spr_goku_sideward_hurt;
            _target.stun_frames = 18;
            _target.knockback_y = -(_target.strong_base_push + _charge_level);
            break;
        case ATTACK_STRONG_LOW:
            _target.hurt_sprite = spr_goku_downward_hurt;
            _target.stun_frames = 18;
            _target.knockback_y = _target.strong_base_push + _charge_level;
            break;
    }
    _target.sprite_index = _target.hurt_sprite;
    _target.image_index = 0;
}

function fighter_begin_combo_stage(_f, _stage) {
    _f.combo_stage = _stage;
    switch (_stage) {
        case 1: _f.combo_timer = _f.combo_duration_1; break;
        case 2: _f.combo_timer = _f.combo_duration_2; break;
        case 3: _f.combo_timer = _f.combo_duration_3; break;
    }
    _f.combo_queued = false;
    _f.combo_hit = false;
    _f.attack_kind = (_stage < 3) ? ATTACK_NORMAL : ATTACK_STRONG;
    _f.attack_charge_level = 0;
    _f.hsp = 0; _f.vsp = 0;
}

function fighter_begin_strong(_f, _kind) {
    _f.attack_kind = _kind;
    _f.combo_stage = 0;
    _f.combo_timer = _f.strong_duration;
    _f.combo_queued = false;
    _f.combo_hit = false;
    _f.hsp = 0; _f.vsp = 0;
}

function fighter_begin_charge(_f, _kind) {
    _f.charging = true;
    _f.charge_kind = _kind;
    _f.charge_frames = 0;
    _f.hsp = 0; _f.vsp = 0;
}

function fighter_release_charge(_f) {
    var _kind = _f.charge_kind;
    var _level = floor(_f.charge_frames / _f.strong_charge_step);
    _f.charging = false;
    _f.charge_kind = ATTACK_NONE;
    fighter_begin_strong(_f, _kind);
    _f.attack_charge_level = _level * _f.strong_charge_push_bonus;
}
