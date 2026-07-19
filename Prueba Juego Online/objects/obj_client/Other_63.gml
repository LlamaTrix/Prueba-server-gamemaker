if (async_load[? "id"] == name_prompt) {
    var _result = async_load[? "result"];
    if (is_undefined(_result)) _result = "";
    username = string_trim(string(_result));
    if (username == "") username = "Jugador" + string(irandom(999));
    username = string_copy(username, 1, 24);
    keyboard_string = "";
    net_connect(net);
}
