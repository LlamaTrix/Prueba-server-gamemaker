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

function fighter_spawn_ki_blast(_f) {
    if (!instance_exists(_f)) return noone;
    var _blast = instance_create_layer(_f.x + _f.facing * 52, _f.y - 50, "Instances", obj_ki_blast);
    _blast.travel_direction = _f.facing;
    _blast.image_xscale = 2 * _f.facing;
    // El proyectil recuerda quién lo lanzó: solo el jugador local reporta el
    // impacto al servidor (así el daño se cuenta una sola vez).
    _blast.owner_instance = _f;
    _blast.owner_is_local = (_f.object_index == obj_player);
    return _blast;
}

/// Estallido celeste en (x, y). Efecto visual, sin lógica de daño.
function fighter_spawn_explosion(_x, _y) {
    return instance_create_layer(_x, _y, "Instances", obj_explosion);
}

function fighter_init(_f) {
    // Duraciones editables, expresadas en frames del juego.
    _f.combo_duration_1 = 20;
    _f.combo_duration_2 = 20;
    _f.combo_duration_3 = 30;
    _f.combo_input_after = 10;
    _f.strong_duration = 30;
    _f.strong_charge_max = 60;
    _f.strong_charge_step = 20;
    _f.strong_base_push = 30;
    _f.strong_charge_push_bonus = 1;

    _f.move_speed = 2.5;
    _f.hsp = 0; _f.vsp = 0; _f.facing = 1;
    _f.stun_frames = 0; _f.knockback_x = 0; _f.knockback_y = 0;
    _f.knockback_active = false; _f.knockback_target_x = _f.x; _f.knockback_target_y = _f.y;
    _f.hurt_sprite = spr_goku_hurted;
    _f.attack_kind = ATTACK_NONE;
    _f.charging = false; _f.charge_kind = ATTACK_NONE; _f.charge_frames = 0;
    _f.attack_charge_level = 0;
    _f.combo_stage = 0; _f.combo_timer = 0; _f.combo_queued = false; _f.combo_hit = false;
    _f.turn_frames = 0; _f.pending_facing = 1;
    _f.dash_frames = 0; _f.dash_direction = 1;
    _f.dash_cooldown = 0; _f.dash_cooldown_frames = 60;
    _f.dash_tap_timer = 0; _f.dash_tap_direction = 0; _f.dash_tap_window = 12;
    _f.dash_visual_frames = 5; _f.dash_distance = 80;
    _f.bubble_text = ""; _f.bubble_timer = 0;
    _f.remote_controlled = false;
    _f.health = 100; _f.ki = 0;
    _f.ki_charging = false; _f.ki_casting = false; _f.ki_forward = false;
    _f.ki_cast_phase = 0; _f.ki_cast_timer = 0; _f.ki_shots = 0; _f.ki_blast_image = 0;
    _f.image_speed = 0; _f.image_xscale = 2; _f.image_yscale = 2;
}

function fighter_receive_hit(_target, _kind, _direction, _charge_level, _server_x, _server_y) {
    if (!instance_exists(_target)) return;
    _target.attack_kind = ATTACK_NONE;
    _target.ki_charging = false; _target.ki_casting = false; _target.ki_cast_phase = 0;
    _target.charging = false; _target.charge_kind = ATTACK_NONE; _target.charge_frames = 0;
    _target.combo_stage = 0; _target.combo_timer = 0; _target.combo_queued = false;
    _target.turn_frames = 0;
    _target.hsp = 0; _target.vsp = 0;
    _target.knockback_x = 0; _target.knockback_y = 0;
    _target.knockback_active = false;
    _target.knockback_target_x = _target.x;
    _target.knockback_target_y = _target.y;

    switch (_kind) {
        case ATTACK_NORMAL:
            _target.hurt_sprite = spr_goku_hurted;
            _target.stun_frames = 12;
            break;
        case ATTACK_STRONG:
            _target.hurt_sprite = spr_goku_sideward_hurt;
            _target.stun_frames = 18;
            _target.knockback_active = true;
            _target.knockback_target_x = _target.x + _direction * (_target.strong_base_push + _charge_level);
            break;
        case ATTACK_STRONG_HIGH:
            _target.hurt_sprite = spr_goku_sideward_hurt;
            _target.stun_frames = 18;
            _target.knockback_active = true;
            _target.knockback_target_y = _target.y - (_target.strong_base_push + _charge_level);
            break;
        case ATTACK_STRONG_LOW:
            _target.hurt_sprite = spr_goku_downward_hurt;
            _target.stun_frames = 18;
            _target.knockback_active = true;
            _target.knockback_target_y = _target.y + (_target.strong_base_push + _charge_level);
            break;
    }
    if (_target.knockback_active && _server_x >= 0 && _server_y >= 0) {
        _target.knockback_target_x = _server_x;
        _target.knockback_target_y = _server_y;
    }
    // El impacto suena en todos los clientes que lo ven.
    if (_kind == ATTACK_NORMAL) audio_play_sound(snd_impact_normal, 5, false);
    else audio_play_sound(snd_strong_punch, 5, false);

    // Voz de Goku al recibir el golpe: probabilistica y sin solaparse.
    if (_kind == ATTACK_NORMAL) {
        if (irandom(99) < 10 && !audio_is_playing(snd_goku_hurt_soft)
            && !audio_is_playing(snd_goku_hurt_strong)) {
            audio_play_sound(snd_goku_hurt_soft, 6, false);
        }
    } else {
        if (irandom(99) < 60 && !audio_is_playing(snd_goku_hurt_strong)
            && !audio_is_playing(snd_goku_hurt_soft)) {
            audio_play_sound(snd_goku_hurt_strong, 6, false);
        }
    }
    _target.sprite_index = _target.hurt_sprite;
    _target.image_index = 0;
}

function fighter_begin_combo_stage(_f, _stage) {
    // Golpe basico: suena al apretar (no al impactar).
    audio_play_sound(snd_punch_basic, 4, false);
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
    // Golpe fuerte: suena al apretar (no al impactar).
    audio_play_sound(snd_punch_strong, 4, false);
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
