// camera_exists() no forma parte de GML. Esta instancia es dueña de la cámara.
if (camera != -1) {
    view_camera[0] = -1;
    camera_destroy(camera);
    camera = -1;
}
