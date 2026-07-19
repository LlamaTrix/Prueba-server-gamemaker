if (stun_frames <= 0 && instance_number(obj_player) > 0) {
    var _p = instance_find(obj_player, 0);
    var _dist = point_distance(x, y, _p.x, _p.y);
    if (_dist > 58 && _dist < 320) {
        var _dir = point_direction(x, y, _p.x, _p.y);
        hsp = lengthdir_x(move_speed, _dir); vsp = lengthdir_y(move_speed, _dir);
        if (hsp != 0) facing = sign(hsp);
    }
}
event_inherited();
