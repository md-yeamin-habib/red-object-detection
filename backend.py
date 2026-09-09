import sqlite3
import threading
import time
from datetime import datetime
from typing import Callable, Optional
from pathlib import Path

import cv2
import numpy as np

MAX_CAMERAS = 4
MIN_RED_AREA = 2500
MIN_RED_PERCENTAGE = 1.0
JPEG_QUALITY = 80

ALERT_COOLDOWN_SECONDS = 60
DETECTION_CONFIRMATION_SECONDS = 1

BASE_DIR = Path(__file__).resolve().parent
DATABASE_FILE = BASE_DIR / "security.db"


camera_lock = threading.Lock()
database_lock = threading.RLock()

camera_states = {}
alert_callback: Optional[Callable] = None

def initialize_camera_states():
    with camera_lock:
        for camera_id in range(1, MAX_CAMERAS + 1):
            camera_states[camera_id] = {
                "id": camera_id,
                "name": f"Camera {camera_id}",
                "connected": False,
                "last_seen": None,
                "latest_frame": None,
                "detected": False,
                "alert_active": False,
                "detection_started_time": None,
                "last_alert_time": 0,
                "red_area": 0,
                "red_percentage": 0.0
            }


def get_db_connection():
    connection = sqlite3.connect(str(DATABASE_FILE), timeout=10)
    connection.row_factory = sqlite3.Row
    return connection

def initialize_database():
    with database_lock:
        connection = get_db_connection()

        try:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS contacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    phone_number TEXT NOT NULL,
                    notification_token TEXT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            connection.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS
                idx_contacts_notification_token
                ON contacts(notification_token)
                WHERE notification_token IS NOT NULL
            """)

            connection.commit()

        finally:
            connection.close()


def get_all_contacts():
    with database_lock:
        connection = get_db_connection()

        try:
            rows = connection.execute("""
                SELECT id,
                       name,
                       phone_number,
                       notification_token,
                       created_at,
                       updated_at
                FROM contacts
                ORDER BY id ASC
            """).fetchall()

            return [dict(row) for row in rows]

        finally:
            connection.close()


def get_contact(contact_id):
    with database_lock:
        connection = get_db_connection()

        try:
            row = connection.execute("""
                SELECT id,
                       name,
                       phone_number,
                       notification_token,
                       created_at,
                       updated_at
                FROM contacts
                WHERE id = ?
            """, (contact_id,)).fetchone()

            return dict(row) if row else None

        finally:
            connection.close()


def register_contact(name, phone_number, notification_token):
    name = str(name).strip()
    phone_number = str(phone_number).strip()
    notification_token = str(notification_token).strip()

    if not name:
        raise ValueError("Name is required.")

    if not phone_number:
        raise ValueError("Phone number is required.")

    if not notification_token:
        raise ValueError("Firebase notification token is required.")

    now = datetime.now().isoformat(timespec="seconds")

    with database_lock:
        connection = get_db_connection()

        try:
            existing = connection.execute("""
                SELECT id
                FROM contacts
                WHERE notification_token = ?
            """, (notification_token,)).fetchone()

            if existing:
                connection.execute("""
                    UPDATE contacts
                    SET name = ?,
                        phone_number = ?,
                        notification_token = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (
                    name,
                    phone_number,
                    notification_token,
                    now,
                    existing["id"]
                ))

                connection.commit()
                contact_id = existing["id"]

            else:
                cursor = connection.execute("""
                    INSERT INTO contacts (
                        name,
                        phone_number,
                        notification_token,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    name,
                    phone_number,
                    notification_token,
                    now,
                    now
                ))

                connection.commit()
                contact_id = cursor.lastrowid

        finally:
            connection.close()

    return get_contact(contact_id)


def update_contact(contact_id, name, phone_number):
    now = datetime.now().isoformat(timespec="seconds")

    with database_lock:
        connection = get_db_connection()

        try:
            cursor = connection.execute("""
                UPDATE contacts
                SET name = ?,
                    phone_number = ?,
                    updated_at = ?
                WHERE id = ?
            """, (
                name,
                phone_number,
                now,
                contact_id
            ))

            connection.commit()

            if cursor.rowcount == 0:
                return None

        finally:
            connection.close()

    return get_contact(contact_id)


def delete_contact(contact_id):
    with database_lock:
        connection = get_db_connection()

        try:
            cursor = connection.execute("""
                DELETE FROM contacts
                WHERE id = ?
            """, (contact_id,))

            connection.commit()

            return cursor.rowcount > 0

        finally:
            connection.close()


def get_notification_tokens():
    contacts = get_all_contacts()

    tokens = []

    for contact in contacts:
        token = contact.get("notification_token")

        if token:
            token = token.strip()

            if token:
                tokens.append(token)

    return tokens


def set_alert_callback(callback: Callable):
    global alert_callback
    alert_callback = callback


def detect_red(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    lower_red_1 = np.array([0, 100, 70])
    upper_red_1 = np.array([10, 255, 255])

    lower_red_2 = np.array([170, 100, 70])
    upper_red_2 = np.array([180, 255, 255])

    mask1 = cv2.inRange(hsv, lower_red_1, upper_red_1)
    mask2 = cv2.inRange(hsv, lower_red_2, upper_red_2)
    mask = mask1 | mask2

    kernel = np.ones((5, 5), np.uint8)

    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_OPEN,
        kernel
    )

    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_CLOSE,
        kernel
    )

    red_pixels = cv2.countNonZero(mask)
    total_pixels = frame.shape[0] * frame.shape[1]
    red_percentage = (red_pixels / total_pixels) * 100

    contours, _ = cv2.findContours(
        mask,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    largest_area = 0
    largest_contour = None

    for contour in contours:
        area = cv2.contourArea(contour)

        if area > largest_area:
            largest_area = area
            largest_contour = contour

    detected = (
        largest_area >= MIN_RED_AREA
        and red_percentage >= MIN_RED_PERCENTAGE
    )

    if detected and largest_contour is not None:
        x, y, w, h = cv2.boundingRect(largest_contour)

        cv2.rectangle(
            frame,
            (x, y),
            (x + w, y + h),
            (0, 0, 255),
            3
        )

        cv2.putText(
            frame,
            "RED OBJECT DETECTED",
            (x, max(y - 10, 30)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 0, 255),
            2
        )

    if detected:
        cv2.putText(
            frame,
            "ALERT",
            (20, 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.2,
            (0, 0, 255),
            3
        )
    else:
        cv2.putText(
            frame,
            "STATUS: NORMAL",
            (20, 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 255, 0),
            2
        )

    cv2.putText(
        frame,
        f"Red area: {largest_area:.0f}",
        (20, 85),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (255, 255, 255),
        2
    )

    cv2.putText(
        frame,
        f"Red pixels: {red_percentage:.2f}%",
        (20, 115),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (255, 255, 255),
        2
    )

    return frame, detected, largest_area, red_percentage


def mark_camera_connected(camera_id):
    with camera_lock:
        camera_states[camera_id]["connected"] = True
        camera_states[camera_id]["last_seen"] = time.time()
        camera_states[camera_id]["alert_active"] = False
        camera_states[camera_id]["detection_started_time"] = None

def mark_camera_disconnected(camera_id):
    with camera_lock:
        camera_states[camera_id]["connected"] = False
        camera_states[camera_id]["last_seen"] = time.time()
        camera_states[camera_id]["detected"] = False
        camera_states[camera_id]["alert_active"] = False
        camera_states[camera_id]["detection_started_time"] = None


def get_available_camera_id():
    with camera_lock:
        for camera_id in range(1, MAX_CAMERAS + 1):
            if not camera_states[camera_id]["connected"]:
                return camera_id

    return None


def get_camera_state(camera_id):
    with camera_lock:
        camera = camera_states.get(camera_id)

        if camera is None:
            return None

        return {
            "id": camera["id"],
            "name": camera["name"],
            "connected": camera["connected"],
            "last_seen": camera["last_seen"],
            "detected": camera["detected"],
            "red_area": camera["red_area"],
            "red_percentage": camera["red_percentage"]
        }


def get_all_camera_states():
    with camera_lock:
        return [
            {
                "id": camera["id"],
                "name": camera["name"],
                "connected": camera["connected"],
                "last_seen": camera["last_seen"],
                "detected": camera["detected"],
                "red_area": camera["red_area"],
                "red_percentage": camera["red_percentage"]
            }
            for camera in camera_states.values()
        ]


def get_latest_frame(camera_id):
    with camera_lock:
        camera = camera_states.get(camera_id)

        if camera is None:
            return None

        return camera["latest_frame"]


def process_camera_frame(camera_id, frame):
    processed_frame, detected, red_area, red_percentage = detect_red(frame)

    success, encoded_frame = cv2.imencode(
        ".jpg",
        processed_frame,
        [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
    )

    if not success:
        return None

    jpeg_bytes = encoded_frame.tobytes()
    now = time.time()
    should_alert = False

    with camera_lock:
        camera = camera_states[camera_id]

        camera["latest_frame"] = jpeg_bytes
        camera["last_seen"] = now
        camera["detected"] = detected
        camera["red_area"] = red_area
        camera["red_percentage"] = red_percentage

        if detected:

            if camera["detection_started_time"] is None:
                camera["detection_started_time"] = now

            detection_duration = (now - camera["detection_started_time"])

            if (
                not camera["alert_active"]
                and detection_duration >= DETECTION_CONFIRMATION_SECONDS
                and now - camera["last_alert_time"] >= ALERT_COOLDOWN_SECONDS
            ):

                camera["alert_active"] = True
                camera["last_alert_time"] = now
                should_alert = True

        else:
            camera["detection_started_time"] = None
            camera["alert_active"] = False

    if should_alert:
        print(f"[ALERT] Red object confirmed on Camera {camera_id}.")

        if alert_callback:
            try:
                alert_callback(camera_id, red_area, red_percentage)
            except Exception as error:
                print(f"[ALERT] Notification error: {error}")

    return jpeg_bytes

def decode_frame(data):
    image_array = np.frombuffer(
        data,
        dtype=np.uint8
    )

    return cv2.imdecode(
        image_array,
        cv2.IMREAD_COLOR
    )


initialize_camera_states()
initialize_database()
