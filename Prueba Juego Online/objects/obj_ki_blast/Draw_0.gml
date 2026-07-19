draw_set_alpha(1);
gpu_set_blendmode(bm_add);
draw_sprite_ext(spr_ki_blast, 0, x, y, 2 * travel_direction, 2, 0, c_white, 1);
gpu_set_blendmode(bm_normal);
