var _chat_blocked = false;
if (instance_number(obj_client) > 0) {
    var _client_instance = instance_find(obj_client, 0);
    _chat_blocked = _client_instance.chat_open;
}

if (!_chat_blocked && stun_frames <= 0) {
    var _busy = attack_kind != ATTACK_NONE || charging || turn_frames > 0;

    if (!_busy) {
        hsp = keyboard_check(vk_right) - keyboard_check(vk_left);
        vsp = keyboard_check(vk_down) - keyboard_check(vk_up);
        if (hsp != 0 || vsp != 0) {
            var _len = point_distance(0, 0, hsp, vsp);
            hsp = hsp / _len * move_speed; vsp = vsp / _len * move_speed;

            with (obj_client) {
                if (net.session_ready && current_time - net.last_activity_sent >= 1000) {
                    net_send_empty(net, MSG_ACTIVITY);
                    net.last_activity_sent = current_time;
                }
            }
        }

        // A: vanish durante exactamente 2 frames y luego cambiar de dirección.
        if (keyboard_check_pressed(ord("A"))) {
            turn_frames = 2;
            pending_facing = -facing;
            hsp = 0; vsp = 0;
        } else if (keyboard_check_pressed(ord("Z"))) {
            fighter_begin_combo_stage(self, 1);
        } else if (keyboard_check_pressed(ord("X"))) {
            if (keyboard_check(vk_up)) fighter_begin_charge(self, ATTACK_STRONG_HIGH);
            else if (keyboard_check(vk_down)) fighter_begin_charge(self, ATTACK_STRONG_LOW);
            else {
                // El fuerte frontal sale inmediatamente y no admite carga.
                fighter_begin_strong(self, ATTACK_STRONG);
                attack_charge_level = 0;
            }
        }
    } else if (charging) {
        hsp = 0; vsp = 0;
        if (keyboard_check(ord("X"))) {
            charge_frames = min(strong_charge_max, charge_frames + 1);
        } else {
            fighter_release_charge(self);
        }
    } else if (keyboard_check_pressed(ord("Z"))
        && combo_stage > 0 && combo_stage < 3
        && ((combo_stage == 1 ? combo_duration_1 : combo_duration_2) - combo_timer >= combo_input_after)) {
        // Se puede enlazar después de combo_input_after frames del golpe actual.
        combo_queued = true;
    }

    if (attack_kind != ATTACK_NONE) {
        hsp = 0; vsp = 0;

        if (!combo_hit) {
            var _hit_x = fighter_hit_x(self);
            var _hit_y = fighter_hit_y(self);
            var _hit_radius = fighter_hit_radius(self);
            var _target = collision_circle(_hit_x, _hit_y, _hit_radius, obj_fighter, false, true);
            if (_target != noone) fighter_receive_hit(_target, attack_kind, facing, attack_charge_level);
            combo_hit = true;
        }

        combo_timer -= 1;
        if (combo_timer <= 0) {
            if (combo_stage > 0 && combo_stage < 3 && combo_queued) {
                fighter_begin_combo_stage(self, combo_stage + 1);
            } else {
                attack_kind = ATTACK_NONE;
                combo_stage = 0;
                combo_timer = 0;
                combo_queued = false;
            }
        }
    }
}

event_inherited();

// Sincronizar posición y dirección aproximadamente 12 veces por segundo.
with (obj_client) {
    if (net.session_ready && current_time - net.last_position_sent >= 80
        && (abs(other.x - net.last_sent_x) >= 0.5
            || abs(other.y - net.last_sent_y) >= 0.5
            || other.facing != net.last_sent_facing)) {
        net_send_position(net, other.x, other.y, other.facing);
        net.last_position_sent = current_time;
        net.last_sent_x = other.x;
        net.last_sent_y = other.y;
        net.last_sent_facing = other.facing;
    }
}
