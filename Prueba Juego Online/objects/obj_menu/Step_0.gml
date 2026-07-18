if (keyboard_check_pressed(ord("C")) || keyboard_check_pressed(vk_enter)) {
    instance_create_depth(0, 0, 0, obj_client);
    instance_destroy();
}
