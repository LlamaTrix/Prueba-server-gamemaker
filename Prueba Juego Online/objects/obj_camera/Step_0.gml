if (instance_number(obj_player) > 0) {
    var _p = instance_find(obj_player, 0);
    camera_set_view_pos(camera, clamp(_p.x - 200, 0, room_width - 400), clamp(_p.y - 200, 0, room_height - 400));
}
