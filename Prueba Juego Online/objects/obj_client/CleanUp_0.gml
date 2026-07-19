// Avisar antes de destruir el socket para que el servidor retire al jugador ya.
if (net.tcp_connected) net_send_empty(net, MSG_LEAVE);
net_close(net);
if (buffer_exists(net.receive_buffer)) buffer_delete(net.receive_buffer);
