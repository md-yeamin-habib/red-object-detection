import os
import time

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_sock import Sock

import backend


app = Flask(__name__, static_folder="static")
sock = Sock(app)

MAX_CAMERAS = backend.MAX_CAMERAS

firebase_initialized = False


def initialize_firebase():
    global firebase_initialized

    service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT")

    if not service_account_path:
        print("[ALERT] Firebase service account not configured.")
        return

    if not os.path.exists(service_account_path):
        print(f"[ALERT] Firebase service account not found: {service_account_path}")
        return

    try:
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            credential = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(credential)

        firebase_initialized = True
        print("[ALERT] Firebase Admin SDK initialized.")

    except ImportError:
        print("[ALERT] firebase-admin is not installed.")

    except Exception as error:
        print(f"[ALERT] Firebase initialization failed: {error}")


def send_security_alert(camera_id, red_area, red_percentage):
    print(
        f"[ALERT] Camera {camera_id} | "
        f"Red area: {red_area:.0f} | "
        f"Red percentage: {red_percentage:.2f}%"
    )

    tokens = backend.get_notification_tokens()

    if not tokens:
        print("[ALERT] No notification tokens available.")
        return

    if not firebase_initialized:
        print("[ALERT] Firebase unavailable. Alert not sent.")
        return

    try:
        from firebase_admin import messaging

        message = messaging.MulticastMessage(
            notification=messaging.Notification(
                title="Security Alert",
                body=f"Red object detected by Camera {camera_id}."
            ),
            data={
                "type": "security_alert",
                "camera_id": str(camera_id),
                "reason": "red_object_detected",
                "red_area": str(round(red_area)),
                "red_percentage": str(round(red_percentage, 2))
            },
            tokens=tokens
        )

        response = messaging.send_each_for_multicast(message)

        print(
            f"[ALERT] Firebase sent | "
            f"Success: {response.success_count} | "
            f"Failed: {response.failure_count}"
        )

    except Exception as error:
        print(f"[ALERT] Firebase notification failed: {error}")


def camera_mjpeg_stream(camera_id):
    while True:
        camera = backend.get_camera_state(camera_id)

        if camera is None:
            break

        frame = backend.get_latest_frame(camera_id)

        if frame is not None:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + frame
                + b"\r\n"
            )

        if not camera["connected"] and frame is None:
            break

        time.sleep(0.03)


def handle_camera_socket(ws, camera_id):
    backend.mark_camera_connected(camera_id)

    print(f"[CAMERA] Camera {camera_id} connected.")

    try:
        while True:
            data = ws.receive()

            if data is None:
                break

            if isinstance(data, str):
                continue

            frame = backend.decode_frame(data)

            if frame is None:
                print(f"[CAMERA] Invalid frame from Camera {camera_id}.")
                continue

            backend.process_camera_frame(
                camera_id,
                frame
            )

    except Exception as error:
        print(f"[CAMERA] Camera {camera_id} error: {error}")

    finally:
        backend.mark_camera_disconnected(camera_id)
        print(f"[CAMERA] Camera {camera_id} disconnected.")


@sock.route("/ws/camera")
def camera_socket(ws):
    camera_id = backend.get_available_camera_id()

    if camera_id is None:
        ws.close()
        return

    handle_camera_socket(ws, camera_id)


@sock.route("/ws/camera/<int:camera_id>")
def camera_socket_with_id(ws, camera_id):
    if camera_id < 1 or camera_id > MAX_CAMERAS:
        ws.close()
        return

    camera = backend.get_camera_state(camera_id)

    if camera is None or camera["connected"]:
        ws.close()
        return

    handle_camera_socket(ws, camera_id)


@app.route("/")
def index():
    return send_from_directory(
        app.static_folder,
        "index.html"
    )


@app.get("/api/status")
def api_status():
    cameras = backend.get_all_camera_states()

    connected = sum(
        camera["connected"]
        for camera in cameras
    )

    detected = sum(
        camera["detected"]
        for camera in cameras
    )

    return jsonify({
        "server": "running",
        "detection": "active",
        "total_cameras": MAX_CAMERAS,
        "connected_cameras": connected,
        "detected_cameras": detected
    })


@app.get("/api/cameras")
def api_cameras():
    cameras = backend.get_all_camera_states()

    return jsonify([
        {
            "id": camera["id"],
            "name": camera["name"],
            "connected": camera["connected"],
            "detected": camera["detected"]
        }
        for camera in cameras
    ])


@app.get("/api/cameras/<int:camera_id>")
def api_camera(camera_id):
    camera = backend.get_camera_state(camera_id)

    if camera is None:
        return jsonify({
            "error": "Camera not found."
        }), 404

    return jsonify(camera)


@app.get("/api/cameras/<int:camera_id>/stream")
def api_camera_stream(camera_id):
    camera = backend.get_camera_state(camera_id)

    if camera is None:
        return jsonify({
            "error": "Camera not found."
        }), 404

    return Response(
        camera_mjpeg_stream(camera_id),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


@app.get("/api/contacts")
def api_get_contacts():
    return jsonify(
        backend.get_all_contacts()
    )


@app.post("/api/contacts")
def api_create_contact():
    data = request.get_json(silent=True) or {}

    name = str(data.get("name", "")).strip()
    phone_number = str(data.get("phone_number", "")).strip()
    notification_token = data.get("notification_token")

    if not name or not phone_number:
        return jsonify({
            "error": "Name and phone number are required."
        }), 400

    if notification_token is not None:
        notification_token = str(
            notification_token
        ).strip() or None

    contact = backend.create_contact(
        name,
        phone_number,
        notification_token
    )

    return jsonify(contact), 201


@app.put("/api/contacts/<int:contact_id>")
def api_update_contact(contact_id):
    data = request.get_json(silent=True) or {}

    name = str(data.get("name", "")).strip()
    phone_number = str(data.get("phone_number", "")).strip()
    notification_token = data.get("notification_token")

    if not name or not phone_number:
        return jsonify({
            "error": "Name and phone number are required."
        }), 400

    if notification_token is not None:
        notification_token = str(
            notification_token
        ).strip() or None

    contact = backend.update_contact(
        contact_id,
        name,
        phone_number,
        notification_token
    )

    if contact is None:
        return jsonify({
            "error": "Contact not found."
        }), 404

    return jsonify(contact)


@app.delete("/api/contacts/<int:contact_id>")
def api_delete_contact(contact_id):
    deleted = backend.delete_contact(
        contact_id
    )

    if not deleted:
        return jsonify({
            "error": "Contact not found."
        }), 404

    return jsonify({
        "success": True
    })


@app.put("/api/contacts/<int:contact_id>/token")
def api_update_contact_token(contact_id):
    data = request.get_json(silent=True) or {}

    token = data.get("notification_token")

    if token is not None:
        token = str(token).strip() or None

    contact = backend.update_contact_token(
        contact_id,
        token
    )

    if contact is None:
        return jsonify({
            "error": "Contact not found."
        }), 404

    return jsonify(contact)


@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({
            "error": "Endpoint not found."
        }), 404

    return jsonify({
        "error": "Page not found."
    }), 404


def initialize():
    initialize_firebase()
    backend.set_alert_callback(
        send_security_alert
    )


initialize()


if __name__ == "__main__":
    print("[SERVER] AI Security System starting.")
    print(f"[SERVER] Cameras: {MAX_CAMERAS}")
    print("[SERVER] Detection: RED OBJECTS ONLY")
    print("[SERVER] Dashboard: http://0.0.0.0:8000")

    app.run(
        host="0.0.0.0",
        port=8000,
        debug=False,
        threaded=True
    )