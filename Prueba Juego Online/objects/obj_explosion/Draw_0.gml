// Estallido celeste con brillo aditivo que se desvanece.
var _t     = life / life_max;                 // 1 -> 0
var _cel   = make_color_rgb(120, 210, 255);
var _white = make_color_rgb(225, 245, 255);

gpu_set_blendmode(bm_add);

// halo exterior difuso
draw_set_color(_cel);
draw_set_alpha(0.30 * _t);
draw_circle(x, y, radius, false);

// anillo de choque
draw_set_alpha(0.95 * _t);
draw_circle_color(x, y, radius, _cel, _cel, true);

// núcleo brillante
draw_set_color(_white);
draw_set_alpha(0.85 * _t);
draw_circle(x, y, radius * 0.45, false);

gpu_set_blendmode(bm_normal);
draw_set_alpha(1);
draw_set_color(c_white);
