if (instance_number(obj_player) > 0) {
    var _p = instance_find(obj_player, 0);
    var _cx = clamp(_p.x - 300, 0, room_width - 600);
    var _cy = clamp(_p.y - 300, 0, room_height - 600);

    // Sacudida: desplaza la cámara con ruido que decae hasta cero.
    if (shake_time > 0) {
        shake_time -= 1;
        var _amt = shake_mag * (shake_time / shake_time_max);
        _cx += random_range(-_amt, _amt);
        _cy += random_range(-_amt, _amt);
    }

    camera_set_view_pos(camera, _cx, _cy);
}
