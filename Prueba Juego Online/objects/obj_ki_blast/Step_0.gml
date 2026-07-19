x += travel_direction * travel_speed;
life_frames -= 1;

if (life_frames <= 0) {
    instance_destroy();
}
