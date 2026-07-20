travel_direction = 1;
travel_speed = 6;
life_frames = 180;
image_speed = 0;
image_index = 0;
image_xscale = 2;
image_yscale = 2;
depth = -100;

// Quién disparó la onda. Solo el proyectil del jugador local reporta el impacto.
owner_instance = noone;
owner_is_local = false;
projectile_id = -1;
owner_uid = 0;

// Lanzar el blast suena en todos los clientes que lo ven aparecer.
audio_play_sound(snd_ki_blast, 4, false);
