draw_set_halign(fa_left);
draw_set_valign(fa_top);

if (net.status == "error") {
    draw_set_color(c_red);
    draw_text_ext(10, 10, net.error, 18, 380);
    draw_set_color(c_white);
    draw_text(10, 64, "R: volver al menu");
    exit;
}

if (net.status != "online") {
    draw_set_color(c_yellow);
    draw_text(10, 10, "Conectando al servidor...");
    exit;
}

var _gw = display_get_gui_width();
var _gh = display_get_gui_height();

// ============ FASES 0/1/3: LOBBY, COUNTDOWN Y GANADOR ============
if (net.match_phase != 2) {
    // fondo opaco que tapa el mundo
    draw_set_color(make_color_rgb(8, 12, 20));
    draw_rectangle(0, 0, _gw, _gh, false);

    draw_set_halign(fa_center);
    draw_set_color(c_aqua);
    draw_text(200, 16, "LOBBY");

    if (net.match_phase == 3) {
        // pantalla de ganador
        draw_set_color(c_yellow);
        draw_text(200, 130, "GANADOR");
        draw_set_color(c_white);
        draw_text(200, 160, net.winner_name + "  (" + string(net.winner_kills) + " puntos)");
        draw_set_color(make_color_rgb(175, 190, 210));
        draw_text(200, 210, "Volviendo al lobby en " + string(max(1, net.match_seconds)) + "...");
        draw_set_halign(fa_left);
        exit;
    }

    // lista de jugadores con su estado de listo
    draw_set_halign(fa_left);
    draw_set_color(make_color_rgb(25, 32, 44));
    draw_rectangle(15, 42, 385, 170, false);
    draw_set_color(make_color_rgb(175, 190, 210));
    draw_text(22, 46, "Jugadores:");
    var _ready_count = 0;
    var _total = array_length(net.match_players);
    for (var _pi = 0; _pi < _total; _pi++) {
        var _entry = net.match_players[_pi];
        if (_entry.ready) _ready_count += 1;
        if (_pi < 6) {
            draw_set_color(_entry.ready ? c_lime : make_color_rgb(150, 160, 175));
            draw_text(30, 66 + _pi * 17, _entry.name + (_entry.ready ? "  [LISTO]" : "  [...]"));
        }
    }

    // chat del lobby
    draw_set_color(make_color_rgb(18, 24, 34));
    draw_rectangle(15, 176, 385, 322, false);
    draw_set_color(make_color_rgb(120, 135, 155));
    draw_text(22, 180, "Chat  (T para escribir)");
    draw_set_color(c_white);
    var _chat_total = array_length(net.chat);
    var _chat_show = min(6, _chat_total);
    for (var _ci = 0; _ci < _chat_show; _ci++) {
        var _line = net.chat[_chat_total - _chat_show + _ci];
        if (string_length(_line) > 46) _line = string_copy(_line, 1, 46);
        draw_text(22, 200 + _ci * 17, _line);
    }

    if (net.match_phase == 1) {
        // countdown para empezar
        draw_set_halign(fa_center);
        draw_set_color(c_yellow);
        draw_text(200, 328, "La partida comienza en " + string(max(1, net.match_seconds)) + "...");
    } else {
        draw_set_halign(fa_center);
        draw_set_color(make_color_rgb(175, 190, 210));
        draw_text(200, 328, "Listos: " + string(_ready_count) + "/" + string(_total));
    }

    // boton JUGAR / CANCELAR
    draw_set_color(net.my_ready ? make_color_rgb(120, 60, 45) : make_color_rgb(35, 120, 90));
    draw_rectangle(110, 344, 290, 384, false);
    draw_set_halign(fa_center);
    draw_set_color(c_white);
    draw_text(200, 356, net.my_ready ? "CANCELAR" : "JUGAR");
    draw_set_halign(fa_left);

    // entrada de chat encima de todo
    if (chat_open) {
        draw_set_color(make_color_rgb(25, 25, 25));
        draw_rectangle(5, 352, 395, 395, false);
        draw_set_color(c_white);
        draw_text(10, 356, "CHAT (Enter enviar / Esc cancelar)");
        var _shown_lobby = chat_input;
        if (string_length(_shown_lobby) > 43) _shown_lobby = string_copy(_shown_lobby, string_length(_shown_lobby) - 42, 43);
        draw_text(10, 376, "> " + _shown_lobby + "_");
    }
    exit;
}

// ============ FASE 2: PARTIDA ============

// --- Overlay de KO: oscurece el juego, borde rojo degradado y contador ---
if (instance_number(obj_player) > 0) {
    var _pl_ko = instance_find(obj_player, 0);
    if (_pl_ko.is_ko) {
        // oscurecer solo el juego (esto se dibuja antes que el HUD)
        draw_set_color(c_black);
        draw_set_alpha(0.55);
        draw_rectangle(0, 0, _gw, _gh, false);
        // borde rojo degradado semitransparente (vineta)
        var _bw = 55;
        draw_set_color(c_red);
        for (var _bi = 0; _bi < _bw; _bi++) {
            draw_set_alpha(0.55 * (1 - _bi / _bw));
            draw_rectangle(_bi, _bi, _gw - 1 - _bi, _gh - 1 - _bi, true);
        }
        draw_set_alpha(1);
        // contador de reaparicion
        var _secs = max(1, ceil(_pl_ko.respawn_timer / 60));
        draw_set_halign(fa_center);
        draw_set_valign(fa_middle);
        draw_set_color(c_white);
        draw_text(_gw / 2, _gh / 2 - 12, "K.O.");
        draw_text(_gw / 2, _gh / 2 + 12, "Reapareciendo en " + string(_secs) + "...");
        draw_set_halign(fa_left);
        draw_set_valign(fa_top);
        draw_set_color(c_white);
    }
}

// HUD compacto: deja visible el mundo y los luchadores.
draw_set_color(make_color_rgb(15, 20, 28));
draw_rectangle(5, 5, 395, 48, false);
draw_set_color(c_aqua);
draw_text(10, 8, username);

// tiempo restante de la partida (M:SS)
var _time_left = net.match_seconds;
var _time_text = string(_time_left div 60) + ":" + string_replace(string_format(_time_left mod 60, 2, 0), " ", "0");
draw_set_halign(fa_center);
draw_set_color(c_yellow);
draw_text(200, 8, _time_text);
draw_set_halign(fa_left);

// marcador: el jugador con mas kills de la partida
var _score_count = array_length(net.match_players);
var _leader = -1;
var _leader_kills = -1;
for (var _si = 0; _si < _score_count; _si++) {
    if (net.match_players[_si].kills > _leader_kills) {
        _leader = _si;
        _leader_kills = net.match_players[_si].kills;
    }
}
if (_leader >= 0) {
    draw_set_color(c_white);
    var _leader_entry = net.match_players[_leader];
    draw_text(10, 27, "Lider: " + _leader_entry.name + " (" + string(_leader_entry.kills) + ")");
}

if (instance_number(obj_player) > 0) {
    var _player = instance_find(obj_player, 0);
    draw_set_halign(fa_right);
    draw_set_color(c_white);
    draw_text(390, 8, "Ping " + (net.ping_ms >= 0 ? string(round(net.ping_ms)) + " ms" : "-- ms"));
    draw_text(390, 27, "Mis puntos: " + string(net_my_kills(net)));
    draw_set_halign(fa_left);
}

// ---- minimapa 100x100 en la esquina inferior izquierda ----
var _mm = 100;
var _mx = 6;
var _my = 400 - _mm - 6; // pegado abajo con un pequeno margen
draw_set_alpha(0.75);
draw_set_color(make_color_rgb(10, 14, 22));
draw_rectangle(_mx, _my, _mx + _mm, _my + _mm, false);
draw_set_alpha(1);
draw_set_color(make_color_rgb(60, 70, 90));
draw_rectangle(_mx, _my, _mx + _mm, _my + _mm, true);

// otros jugadores en rojo
for (var _i = 0; _i < instance_number(obj_remote); _i++) {
    var _r = instance_find(obj_remote, _i);
    var _rx = _mx + clamp(_r.x / room_width, 0, 1) * _mm;
    var _ry = _my + clamp(_r.y / room_height, 0, 1) * _mm;
    draw_set_color(c_red);
    draw_circle(_rx, _ry, 2.5, false);
}

// tu, en azul
if (instance_number(obj_player) > 0) {
    var _pl = instance_find(obj_player, 0);
    var _plx = _mx + clamp(_pl.x / room_width, 0, 1) * _mm;
    var _ply = _my + clamp(_pl.y / room_height, 0, 1) * _mm;
    draw_set_color(make_color_rgb(60, 140, 255));
    draw_circle(_plx, _ply, 3, false);
}

draw_set_color(c_white);
if (chat_open) {
    draw_set_color(make_color_rgb(25, 25, 25));
    draw_rectangle(5, 352, 395, 395, false);
    draw_set_color(c_white);
    draw_text(10, 356, "CHAT (Enter enviar / Esc cancelar)");
    var _shown = chat_input;
    if (string_length(_shown) > 43) _shown = string_copy(_shown, string_length(_shown) - 42, 43);
    draw_text(10, 376, "> " + _shown + "_");
}
