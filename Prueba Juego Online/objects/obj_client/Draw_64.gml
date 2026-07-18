if (error_msg != "") {
    draw_set_color(c_red);
    draw_text(20, 20, error_msg);
    exit;
}
if (!connected) {
    draw_set_color(c_yellow);
    draw_text(20, 20, "Conectando...");
    exit;
}

// ---- cabecera ----
draw_set_color(c_aqua);
draw_text(20, 20, "Tu nombre: " + username + "   (UID: " + string(my_uid) + ")");

// ---- lista de jugadores (izquierda) ----
draw_set_color(c_white);
draw_text(20, 60, "Personas en la sala (" + string(array_length(players)) + "):");
for (var i = 0; i < array_length(players); i++) {
    draw_text(40, 90 + i * 25, "- " + players[i]);
}

// ---- chat (derecha) ----
var cx = 420;
draw_set_color(c_yellow);
draw_text(cx, 60, "CHAT  (escribe y presiona ENTER)");
draw_set_color(c_white);
for (var i = 0; i < array_length(chat_log); i++) {
    draw_text(cx, 90 + i * 25, chat_log[i]);
}

// caja de entrada
var iy = display_get_gui_height() - 50;
draw_set_color(c_gray);
draw_rectangle(cx - 6, iy - 6, cx + 700, iy + 26, true);
draw_set_color(c_lime);
draw_text(cx, iy, "> " + chat_input + "_");
