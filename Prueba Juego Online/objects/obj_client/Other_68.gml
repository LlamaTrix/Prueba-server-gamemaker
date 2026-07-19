var type = async_load[? "type"];
show_debug_message("[cliente] evento de red tipo " + string(type));

switch (type) {
    case network_type_disconnect:
        connected = false;
        error_msg = "Se perdió la conexión con el servidor";
        break;

    case network_type_non_blocking_connect: {
        // resultado de network_connect_raw_async
        var ok = async_load[? "succeeded"];
        show_debug_message("[cliente] resultado de conexión (succeeded=" + string(ok) + ")");
        if (ok) {
            show_debug_message("[cliente] conectado, enviando MSG_JOIN...");
            connected = true;
            estado = "conectado";
            net_send_string(client, MSG_JOIN, username);
        } else {
            estado = "error";
            error_msg = "No se pudo conectar a " + SERVER_IP + ":" + string(SERVER_PORT);
        }
    } break;

    case network_type_data: {
        var buf  = async_load[? "buffer"];
        var size = async_load[? "size"];
        show_debug_message("[cliente] datos recibidos: " + string(size) + " bytes");

        // acumular lo recibido al final de inbuf
        buffer_copy(buf, 0, size, inbuf, inbuf_size);
        inbuf_size += size;

        // procesar todas las tramas completas ([u16 largo][payload])
        while (inbuf_size >= 2) {
            buffer_seek(inbuf, buffer_seek_start, 0);
            var len = buffer_read(inbuf, buffer_u16);
            if (inbuf_size < 2 + len) break; // trama incompleta, esperar más datos

            // ---- procesar payload (inbuf queda posicionado en el byte 2) ----
            var msg = buffer_read(inbuf, buffer_u8);
            switch (msg) {
                case MSG_WELCOME:
                    my_uid = buffer_read(inbuf, buffer_u16);
                    break;

                case MSG_PLAYER_LIST: {
                    var total = buffer_read(inbuf, buffer_u16);
                    players = [];
                    for (var i = 0; i < total; i++) {
                        array_push(players, buffer_read(inbuf, buffer_string));
                    }
                } break;

                case MSG_CHAT: {
                    var who  = buffer_read(inbuf, buffer_string);
                    var text = buffer_read(inbuf, buffer_string);
                    array_push(chat_log, who + ": " + text);
                    while (array_length(chat_log) > 14) array_delete(chat_log, 0, 1);
                } break;
            }

            // ---- quitar la trama procesada del inicio del buffer ----
            var rest = inbuf_size - (2 + len);
            if (rest > 0) {
                var tmp = buffer_create(rest, buffer_fixed, 1);
                buffer_copy(inbuf, 2 + len, rest, tmp, 0);
                buffer_copy(tmp, 0, rest, inbuf, 0);
                buffer_delete(tmp);
            }
            inbuf_size = rest;
        }
    } break;
}
