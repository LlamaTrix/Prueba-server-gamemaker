var _type = async_load[? "type"];
var _event_socket = async_load[? "id"];

// Ignorar eventos tardíos pertenecientes a un socket ya reemplazado.
if (_event_socket != net.socket) exit;

switch (_type) {
    case network_type_non_blocking_connect:
        if (async_load[? "succeeded"] == 1) {
            net.tcp_connected = true;
            net.status = "joining";
            if (!net_send_string(net, MSG_JOIN, username)) {
                net.error = "Se conectó, pero no se pudo enviar el ingreso";
                net.status = "error";
                net_close(net);
            }
        } else {
            net_close(net);
            net.status = "error";
            net.error = "El servidor no aceptó la conexión";
        }
        break;

    case network_type_disconnect:
        net_close(net);
        net.status = "error";
        net.error = "Se perdió la conexión con el servidor";
        break;

    case network_type_data:
        if (!net_receive(net, async_load[? "buffer"], async_load[? "size"])) {
            net_close(net);
            net.status = "error";
            net.error = "El servidor envió una trama inválida";
        } else if (net.kicked) {
            var _kick_reason = net.error;
            net_close(net);
            net.status = "error";
            net.error = _kick_reason;
        }
        break;
}
