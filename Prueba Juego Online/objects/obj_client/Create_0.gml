username  = "";
my_uid    = -1;
connected = false;
error_msg = "";
players   = [];
client    = -1;

// chat
chat_log   = [];   // líneas ya formateadas ("nombre: texto")
chat_input = "";

// buffer de recepción: acumula bytes hasta tener tramas completas
inbuf      = buffer_create(2048, buffer_grow, 1);
inbuf_size = 0;

name_prompt = get_string_async("Escribe tu nombre de usuario:", "Jugador");
