// Suavizar los paquetes de posición recibidos para evitar saltos visuales.
hsp = (target_x - x) * 0.35;
vsp = (target_y - y) * 0.35;
if (abs(hsp) < 0.1) hsp = 0;
if (abs(vsp) < 0.1) vsp = 0;
event_inherited();
