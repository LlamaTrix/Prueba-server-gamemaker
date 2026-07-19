// Suavizar los paquetes de posición recibidos para evitar saltos visuales.
hsp = (target_x - x) * 0.35;
vsp = (target_y - y) * 0.35;
if (abs(hsp) < 0.1) hsp = 0;
if (abs(vsp) < 0.1) vsp = 0;

// Las animaciones remotas llegan desde MSG_ATTACK_STATE y expiran localmente.
if (attack_kind != ATTACK_NONE && stun_frames <= 0) {
    combo_timer -= 1;
    if (combo_timer <= 0) {
        attack_kind = ATTACK_NONE;
        combo_stage = 0;
        combo_timer = 0;
    }
}
event_inherited();
