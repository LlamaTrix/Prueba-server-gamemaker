if (stun_frames <= 0) {
    var _busy = attack_kind != ATTACK_NONE || charging || turn_frames > 0;

    if (!_busy) {
        hsp = keyboard_check(vk_right) - keyboard_check(vk_left);
        vsp = keyboard_check(vk_down) - keyboard_check(vk_up);
        if (hsp != 0 || vsp != 0) {
            var _len = point_distance(0, 0, hsp, vsp);
            hsp = hsp / _len * move_speed; vsp = vsp / _len * move_speed;
            if (hsp != 0) facing = sign(hsp);

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
            else fighter_begin_charge(self, ATTACK_STRONG);
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
            var _x1 = (facing == 1) ? x + 12 : x - 72;
            var _x2 = (facing == 1) ? x + 72 : x - 12;
            var _target = collision_rectangle(_x1, y - 58, _x2, y + 4, obj_fighter, false, true);
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
