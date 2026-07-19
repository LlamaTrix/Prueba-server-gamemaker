var _chat_blocked = false;
net_input_dx = 0;
net_input_dy = 0;
if (abs(net_correction_x) > 0.01 || abs(net_correction_y) > 0.01) {
    var _correct_x = net_correction_x * 0.25;
    var _correct_y = net_correction_y * 0.25;
    x += _correct_x; y += _correct_y;
    net_correction_x -= _correct_x; net_correction_y -= _correct_y;
}
if (instance_number(obj_client) > 0) {
    var _client_instance = instance_find(obj_client, 0);
    _chat_blocked = _client_instance.chat_open;
}

if (!_chat_blocked && stun_frames <= 0) {
    // Recarga de ki con D: un punto por frame, validado también por el servidor.
    if (ki_charging) {
        hsp = 0; vsp = 0;
        if (keyboard_check(ord("D")) && ki < 100) {
            ki = min(100, ki + 1);
        } else {
            ki_charging = false;
            with (obj_client) {
                if (net.session_ready) net_send_ki_charge(net, false);
            }
        }
    }

    // Secuencia de ondas normales o recuperación del forward blast.
    if (ki_casting) {
        hsp = 0; vsp = 0;
        if (ki_forward) {
            ki_cast_timer -= 1;
            if (ki_cast_timer <= 0) { ki_casting = false; ki_forward = false; }
        } else if (ki_cast_phase == 1) {
            if (!keyboard_check(ord("C"))) { ki_cast_phase = 3; ki_cast_timer = 20; ki_blast_image = 1; }
            else {
                ki_cast_timer -= 1;
                if (ki_cast_timer <= 0) { ki_cast_phase = 2; ki_cast_timer = 5; }
            }
        } else if (ki_cast_phase == 2) {
            if (!keyboard_check(ord("C"))) { ki_cast_phase = 3; ki_cast_timer = 20; ki_blast_image = 1; }
            else {
                ki_cast_timer -= 1;
                if (ki_cast_timer <= 0) {
                    if (ki_shots < 5 && ki >= 5) {
                        ki -= 5;
                        ki_shots += 1;
                        ki_blast_image = 1 - ki_blast_image;
                        with (obj_client) {
                            if (net.session_ready) net_send_ki_fire(net, false);
                        }
                        fighter_spawn_ki_blast(id);
                    }
                    if (ki_shots >= 5 || ki < 5) { ki_cast_phase = 3; ki_cast_timer = 20; ki_blast_image = 1; }
                    else ki_cast_timer = 5;
                }
            }
        } else if (ki_cast_phase == 3) {
            ki_cast_timer -= 1;
            if (ki_cast_timer <= 0) { ki_casting = false; ki_cast_phase = 0; }
        }
    }

    var _did_dash = false;
    var _lateral_press = keyboard_check_pressed(vk_right) - keyboard_check_pressed(vk_left);
    if (_lateral_press != 0 && attack_kind == ATTACK_NONE && !charging
        && !ki_charging && !ki_casting && turn_frames <= 0) {
        if (dash_tap_timer > 0 && dash_tap_direction == _lateral_press
            && dash_cooldown <= 0 && ki >= 5) {
            ki -= 5;
            dash_cooldown = dash_cooldown_frames;
            dash_frames = dash_visual_frames;
            dash_direction = _lateral_press;
            // Primero fija la posición de salida en el servidor; TCP conserva este orden.
            with (obj_client) {
                if (net.session_ready) {
                    net_send_dash(net, other.dash_direction);
                }
            }
            x = clamp(x + dash_direction * dash_distance, 20, room_width - 20);
            hsp = 0; vsp = 0;
            dash_tap_timer = 0; dash_tap_direction = 0;
            _did_dash = true;
        } else {
            dash_tap_direction = _lateral_press;
            dash_tap_timer = dash_tap_window;
        }
    }

    var _busy = attack_kind != ATTACK_NONE || charging || ki_charging || ki_casting
        || turn_frames > 0 || _did_dash;

    if (!_busy) {
        net_input_dx = keyboard_check(vk_right) - keyboard_check(vk_left);
        net_input_dy = keyboard_check(vk_down) - keyboard_check(vk_up);
        hsp = net_input_dx;
        vsp = net_input_dy;
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

        if (keyboard_check_pressed(ord("D")) && ki < 100) {
            ki_charging = true;
            hsp = 0; vsp = 0;
            with (obj_client) {
                if (net.session_ready) net_send_ki_charge(net, true);
            }
        } else if (keyboard_check_pressed(ord("C")) && ki >= 5) {
            var _forward_blast = abs(hsp) > 0.01 && sign(hsp) == facing;
            ki -= 5;
            ki_casting = true;
            ki_forward = _forward_blast;
            ki_shots = 1;
            ki_blast_image = 0;
            ki_cast_phase = _forward_blast ? 3 : 1;
            ki_cast_timer = _forward_blast ? 10 : 20;
            hsp = 0; vsp = 0;
            with (obj_client) {
                if (net.session_ready) net_send_ki_fire(net, _forward_blast);
            }
            fighter_spawn_ki_blast(id);
        // A: vanish durante exactamente 2 frames y luego cambiar de dirección.
        } else if (keyboard_check_pressed(ord("A"))) {
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
            with (obj_client) {
                if (net.session_ready) net_send_attack(net, other.attack_kind, other.attack_charge_level, other.combo_stage);
            }
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

// Enviar comandos numerados; el servidor responde con snapshots autoritativos.
with (obj_client) {
    if (net.session_ready && other.stun_frames <= 0
        && (other.net_input_dx != 0 || other.net_input_dy != 0
            || other.facing != net.last_sent_facing)) {
        net.input_sequence += 1;
        var _command = { sequence: net.input_sequence, dx: other.net_input_dx, dy: other.net_input_dy };
        array_push(net.pending_inputs, _command);
        if (array_length(net.pending_inputs) > 180) array_delete(net.pending_inputs, 0, 1);
        net_send_input(net, net.input_sequence, other.net_input_dx, other.net_input_dy, other.facing);
        net.last_sent_facing = other.facing;
    }
}
