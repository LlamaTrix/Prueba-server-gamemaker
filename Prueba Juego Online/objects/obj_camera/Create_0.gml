view_enabled = true; view_visible[0] = true;
camera = camera_create_view(800, 800, 600, 600);
view_camera[0] = camera;

// Sacudida de cámara al recibir un golpe.
shake_time = 0;
shake_time_max = 1;
shake_mag = 0;
