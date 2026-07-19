var _cam = view_camera[0];
if (_cam != -1) {
    var _cx = camera_get_view_x(_cam), _cy = camera_get_view_y(_cam);
    draw_set_color(make_color_rgb(28, 35, 44));
    for (var _x = floor(_cx / 100) * 100; _x <= _cx + 400; _x += 100) draw_line(_x, _cy, _x, _cy + 400);
    for (var _y = floor(_cy / 100) * 100; _y <= _cy + 400; _y += 100) draw_line(_cx, _y, _cx + 400, _y);
}
