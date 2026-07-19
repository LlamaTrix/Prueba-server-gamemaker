// El servidor es la única autoridad de colisión y daño. Esta instancia
// interpola visualmente el mismo movimiento hasta recibir DESTROY.
x += travel_direction * travel_speed;
life_frames -= 1;
if (life_frames <= -30) instance_destroy();
