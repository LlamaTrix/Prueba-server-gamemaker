radius += (max_radius - radius) * 0.4;
life   -= 1;
if (life <= 0) instance_destroy();
