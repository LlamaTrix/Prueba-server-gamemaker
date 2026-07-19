x += travel_direction * travel_speed;
life_frames -= 1;

// ¿Golpeó a algún luchador que no sea quien la lanzó?
var _hit = collision_circle(x, y, 16, obj_fighter, false, true);
if (_hit != noone && _hit != owner_instance) {
    // El jugador local es quien reporta el impacto: el servidor valida y aplica daño.
    if (owner_is_local && instance_exists(obj_client)) {
        var _target_uid = (_hit.object_index == obj_remote) ? _hit.remote_uid : _hit.net_uid;
        with (obj_client) {
            if (net.session_ready) net_send_ki_hit(net, _target_uid);
        }
    }
    fighter_spawn_explosion(x, y);
    instance_destroy();
    exit;
}

if (life_frames <= 0) {
    instance_destroy();
}
