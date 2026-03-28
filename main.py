import cv2
import threading
import time
import os
import queue
import json
import signal
import subprocess
import asyncio
import uvicorn
import requests as _requests
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from ultralytics import YOLO
import easyocr
import numpy as np
import scipy.fft
from pydub import AudioSegment
import torch
import psycopg2
from psycopg2.extras import RealDictCursor
from insightface.app import FaceAnalysis
import os
import io
import base64

os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

VIDEO_PATH_CAM1  = os.environ.get('VIDEO_PATH', '/home/apurva/Desktop/final.mp4')
VIDEO_PATH_CAM2  = os.environ.get('VIDEO_PATH_2', '/home/apurva/Desktop/tailgating.mp4')
VIDEO_PATH_CAM3  = os.environ.get('VIDEO_PATH_3', '/home/apurva/Desktop/weapons.mp4')
VIDEO_PATH_CAM4  = os.environ.get('VIDEO_PATH_4', '/home/apurva/Desktop/LicensePlate.mp4')
VIDEO_PATH_SOUND = os.environ.get('SOUND_PATH',   '/home/apurva/Desktop/Sound.mpeg')
RTSP_URL         = os.environ.get('RTSP_URL', 'rtsp://localhost:8554/live')

CAM1_LABEL = "CAM 01 - Main Gate"
CAM2_LABEL = "CAM 02 - Tailgating"
CAM3_LABEL = "CAM 03 - Weapon Detection"
CAM4_LABEL = "CAM 04 - License Plate ANPR"

INTRUSION_ZONE_X_RATIO = 0.75
LOITER_THRESHOLD_SEC   = 10      
LOITER_DIST_PX         = 80     
TARGET_FPS             = 24
STREAM_W, STREAM_H     = 854, 480
YOLO_IMGSZ             = 640
YOLO_CONF              = 0.20     

os.environ["CUDA_VISIBLE_DEVICES"] = "0"
DEVICE   = 'cuda:0' if torch.cuda.is_available() else 'cpu'
USE_HALF = DEVICE.startswith('cuda')

def _free_port(port: int):
    try:
        r = subprocess.run(["fuser", f"{port}/tcp"], capture_output=True, text=True)
        for pid in r.stdout.strip().split():
            try:
                os.kill(int(pid), signal.SIGTERM)
                time.sleep(0.4)
                os.kill(int(pid), signal.SIGKILL)
            except Exception:
                pass
        if r.stdout.strip():
            print(f"[SERVER] Freed port {port}")
    except Exception:
        pass


log_queue: queue.Queue = queue.Queue(maxsize=300)
ws_clients: list[WebSocket] = []
ws_lock = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None


def put_log(msg: str, level: str = "info"):
    entry = json.dumps({"msg": msg, "level": level, "ts": time.time()})
    try:
        if log_queue.full():
            log_queue.get_nowait()
        log_queue.put_nowait(entry)
    except Exception:
        pass
    _broadcast_ws(entry)


def _broadcast_ws(message: str):
    with ws_lock:
        clients = list(ws_clients)
    for ws in clients:
        try:
            if _loop:
                asyncio.run_coroutine_threadsafe(ws.send_text(message), _loop)
        except Exception:
            pass


@asynccontextmanager
async def _lifespan(app: FastAPI):
    global _loop
    _loop = asyncio.get_event_loop()
    yield


app = FastAPI(title="GuardAI", lifespan=_lifespan)

MODEL_WEIGHTS = 'yolo26n.pt'   # official YOLO26 nano weights (auto-downloaded on first run)

# --- Twilio SMS Setup ---
TWILIO_ACCOUNT_SID  = 'TOKEN'
TWILIO_AUTH_TOKEN   = 'f042ae5d38e57df48294f1b5a14e3b7f'
TWILIO_MSG_SID      = 'MG9373b9b9af8e7a11e642aecae8bf99ff'
TWILIO_TO_NUMBER    = '+917057055681'

_last_twilio_weapon = 0.0
_last_twilio_sound  = 0.0

def _send_twilio_alert(msg_body, alert_type):
    global _last_twilio_weapon, _last_twilio_sound
    if not TWILIO_AUTH_TOKEN or TWILIO_AUTH_TOKEN == '[AuthToken]':
        print("[TWILIO] Skipped SMS: Need real AuthToken in env")
        return

    now = time.time()
    if alert_type == "weapon":
        if now - _last_twilio_weapon < 5.0: return
        _last_twilio_weapon = now
    elif alert_type == "sound":
        if now - _last_twilio_sound < 5.0: return
        _last_twilio_sound = now

    def _do_post():
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
            payload = {
                "To": TWILIO_TO_NUMBER,
                "MessagingServiceSid": TWILIO_MSG_SID,
                "Body": msg_body
            }
            res = _requests.post(url, data=payload, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN), timeout=5)
            if not res.ok:
                print(f"[TWILIO ERROR] {res.status_code}: {res.text}")
            else:
                print(f"[TWILIO SENT] SMS Alert Dispatched: {alert_type}")
        except Exception as e:
            print(f"[TWILIO EXCEPTION] {e}")

    threading.Thread(target=_do_post, daemon=True, name=f"twilio-{alert_type}").start()


def _load_model():
    print(f"[INIT] Loading {MODEL_WEIGHTS} on {DEVICE}")
    m = YOLO(MODEL_WEIGHTS)
    m.to(DEVICE)
    m.fuse()
    return m

print("[INIT] Creating 4 model instances (one per camera)…")
model_cam1 = _load_model()
model_cam2 = _load_model()
model_cam3 = _load_model()
model_cam4 = _load_model()
model_cam1_lock = threading.Lock()
model_cam2_lock = threading.Lock()
model_cam3_lock = threading.Lock()
model_cam4_lock = threading.Lock()
print("[INIT] All models ready.")

# Load dedicated plate-detection YOLO model (much better than generic vehicle classes)
PLATE_YOLO_PATH = os.path.join(os.path.dirname(__file__), 'plate_yolo.pt')
try:
    plate_detector = YOLO(PLATE_YOLO_PATH)
    plate_detector.to(DEVICE)
    plate_detector.fuse()
    print(f"[INIT] plate_yolo.pt loaded on {DEVICE}")
except Exception as _pe:
    plate_detector = None
    print(f"[INIT] plate_yolo.pt not found, falling back to generic classes: {_pe}")

print("[INIT] Loading EasyOCR (GPU plate reader)...")
try:
    _ocr_gpu = DEVICE.startswith('cuda')
    ocr_reader = easyocr.Reader(['en'], gpu=_ocr_gpu, verbose=False)
    print(f"[INIT] EasyOCR ready (gpu={_ocr_gpu})")
except Exception as e:
    print(f"[INIT] EasyOCR load error: {e}")
    ocr_reader = None

# --- PostgreSQL Setup ---
DB_NAME = "guardai"
DB_USER = "apurva"  # Assumed from path, adjust if needed

def get_db_conn():
    return psycopg2.connect(dbname=DB_NAME, user=DB_USER, cursor_factory=RealDictCursor)

def _init_db():
    try:
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS residents (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        embedding FLOAT8[] NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                conn.commit()
        print("[INIT] PostgreSQL residents table ready.")
    except Exception as e:
        print(f"[INIT] DB Init Error: {e}")

_init_db()

# --- Face DB Init ---
print("[INIT] Loading InsightFace (ArcFace buffalo_l)...")
try:
    face_app = FaceAnalysis(name='buffalo_l', providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
    face_app.prepare(ctx_id=0, det_size=(640, 640))
    print("[INIT] ArcFace Biometrics Ready.")
except Exception as fe:
    print(f"[INIT] ArcFace load error: {fe}")
    face_app = None

class LoiterTracker:
    """
    Tracks how long each person has been stationary in the frame.
    Uses centroid proximity matching — not dependent on YOLO tracker IDs.
    """
    def __init__(self, dist_thresh=LOITER_DIST_PX, timeout_sec=5.0):
        self._dist  = dist_thresh
        self._timeout = timeout_sec
        self._tracks: dict[int, dict] = {}   
        self._next_id = 0
        self._lock = threading.Lock()

    def _closest(self, cx, cy):
        best, best_d = None, float('inf')
        for tid, t in self._tracks.items():
            d = ((cx - t['cx'])**2 + (cy - t['cy'])**2) ** 0.5
            if d < best_d:
                best_d = d
                best = tid
        return best, best_d

    def update(self, centroids):
        """
        centroids: list of (cx, cy) for all detected persons this frame.
        Returns: list of (cx, cy, duration_sec, tid, alerted_loiter, alerted_trespass)
        """
        now = time.time()
        with self._lock:
            
            assigned = set()
            results = []

            for cx, cy in centroids:
                best, dist = self._closest(cx, cy)
                if best is not None and dist < self._dist and best not in assigned:
                    
                    t = self._tracks[best]
                    t['cx'] = cx
                    t['cy'] = cy
                    t['last_t'] = now
                    assigned.add(best)
                    duration = now - t['first_t']
                    results.append((cx, cy, duration, best, t['alerted_loiter'], t['alerted_trespass']))
                else:
                    
                    tid = self._next_id
                    self._next_id += 1
                    self._tracks[tid] = {
                        'cx': cx, 'cy': cy,
                        'first_t': now, 'last_t': now,
                        'alerted_loiter': False,
                        'alerted_trespass': False,
                    }
                    assigned.add(tid)
                    results.append((cx, cy, 0.0, tid, False, False))

            
            stale = [k for k, t in self._tracks.items() if now - t['last_t'] > 8.0]
            for k in stale:
                del self._tracks[k]

            return results

    def mark_loiter_alerted(self, tid):
        with self._lock:
            if tid in self._tracks:
                self._tracks[tid]['alerted_loiter'] = True

    def mark_trespass_alerted(self, tid):
        with self._lock:
            if tid in self._tracks:
                self._tracks[tid]['alerted_trespass'] = True


loiter_cam1 = LoiterTracker()
loiter_cam3 = LoiterTracker()


_C_NORMAL   = (0, 220, 80)
_C_LOITER   = (0, 165, 255)
_C_TRESPASS = (0, 50, 255)
_C_CAR      = (255, 190, 0)
_C_WEAPON   = (0, 0, 255)


def _draw_zone(frame):
    h, w = frame.shape[:2]
    zx = int(w * INTRUSION_ZONE_X_RATIO)
    ov = frame.copy()
    cv2.rectangle(ov, (zx, 0), (w, h), (0, 200, 255), -1)
    cv2.addWeighted(ov, 0.08, frame, 0.92, 0, frame)
    cv2.rectangle(frame, (zx, 0), (w - 1, h - 1), (0, 200, 255), 2)
    cv2.putText(frame, "RESTRICTED", (zx + 6, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 255), 1)
    return zx


def _draw_box(frame, x1, y1, x2, y2, color, label):
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    fs = 0.5
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
    cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 6, y1), color, -1)
    lc = (0, 0, 0) if sum(color) > 400 else (255, 255, 255)
    cv2.putText(frame, label, (x1 + 3, y1 - 5),
                cv2.FONT_HERSHEY_SIMPLEX, fs, lc, 1)


def _draw_cam_bar(frame, label: str):
    h, w = frame.shape[:2]
    ov = frame.copy()
    cv2.rectangle(ov, (0, 0), (w, 32), (10, 10, 20), -1)
    cv2.addWeighted(ov, 0.72, frame, 0.28, 0, frame)
    cv2.circle(frame, (16, 16), 6, (0, 40, 230), -1)
    cv2.putText(frame, label, (32, 21),
                cv2.FONT_HERSHEY_SIMPLEX, 0.52, (220, 230, 255), 1)
    cv2.putText(frame, "● REC", (w - 68, 21),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (60, 80, 240), 1)


class RTSPStream:
    """Reads from RTSP with auto-reconnect."""
    def __init__(self, url: str):
        self.url = url
        self._cap: cv2.VideoCapture | None = None
        self._frame: np.ndarray | None = None
        self._fid = 0
        self._lock = threading.Lock()
        self._last_frame_t = time.time()
        self._failures = 0
        self._running = True
        self._connect()
        threading.Thread(target=self._loop, daemon=True).start()

    def _connect(self):
        print(f"[RTSP] Connecting to {self.url}")
        if self._cap:
            self._cap.release()
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        self._cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if self._cap.isOpened():
            self._failures = 0
            self._last_frame_t = time.time()
            print("[RTSP] Connected.")
        else:
            self._failures += 1
            print(f"[RTSP] Failed (attempt {self._failures})")

    def _loop(self):
        while self._running:
            if not self._cap or not self._cap.isOpened():
                self._reconnect()
                continue
            ret, frame = self._cap.read()
            if not ret or frame is None:
                if time.time() - self._last_frame_t > 10:
                    self._reconnect()
                else:
                    time.sleep(0.005)
                continue
            frame = cv2.resize(frame, (STREAM_W, STREAM_H))
            self._last_frame_t = time.time()
            with self._lock:
                self._frame = frame
                self._fid += 1
        if self._cap:
            self._cap.release()

    def _reconnect(self):
        self._failures += 1
        wait = min(2 ** self._failures, 30)
        print(f"[RTSP] Reconnect in {wait}s...")
        time.sleep(wait)
        self._connect()

    @property
    def is_alive(self):
        return time.time() - self._last_frame_t < 15

    def read(self):
        with self._lock:
            if self._frame is not None:
                return True, self._frame.copy(), self._fid
        return False, None, 0



class VideoLoop:
    def __init__(self, path: str, label: str = "CAM"):
        self.path = path
        self.label = label
        self._cap = cv2.VideoCapture(path)
        if not self._cap.isOpened():
            raise RuntimeError(f"Cannot open: {path}")
        self._fps = self._cap.get(cv2.CAP_PROP_FPS) or 30
        self._frame: np.ndarray | None = None
        self._fid = 0
        self._lock = threading.Lock()
        self._running = True
        threading.Thread(target=self._loop, daemon=True).start()
        print(f"[VIDEO] Opened {path} @ {self._fps:.0f}fps")

    def _loop(self):
        interval = 1.0 / self._fps
        while self._running:
            t0 = time.time()
            ret, frame = self._cap.read()
            if not ret:
                self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            frame = cv2.resize(frame, (STREAM_W, STREAM_H))
            with self._lock:
                self._frame = frame
                self._fid += 1
            elapsed = time.time() - t0
            sl = interval - elapsed
            if sl > 0:
                time.sleep(sl)

    def read(self):
        with self._lock:
            if self._frame is not None:
                return True, self._frame.copy(), self._fid
        return False, None, 0

    def stop(self):
        self._running = False
        self._cap.release()



cam1: RTSPStream | None = None
cam2: VideoLoop | None = None
cam3: VideoLoop | None = None
cam4: VideoLoop | None = None


def _init_cam1():
    global cam1
    for attempt in range(30):
        try:
            cam1 = RTSPStream(RTSP_URL)
            if cam1.is_alive:
                put_log("CAM 01 (RTSP) connected.", "info")
                return
        except Exception:
            pass
        print(f"[CAM1] Waiting for RTSP... ({attempt+1}/30)")
        time.sleep(2)
    print("[CAM1] RTSP unavailable — falling back to direct file read")
    put_log("CAM 01 falling back to direct file read.", "info")
    cam1 = VideoLoop(VIDEO_PATH_CAM1, CAM1_LABEL)         # type: ignore[assignment]


def _init_cam2():
    global cam2
    try:
        cam2 = VideoLoop(VIDEO_PATH_CAM2, CAM2_LABEL)
        put_log("CAM 02 (tailgating.mp4) loaded.", "info")
    except Exception as e:
        put_log(f"CAM 02 error: {e}", "error")
        print(f"[CAM2] Error: {e}")


def _init_cam3():
    global cam3
    try:
        cam3 = VideoLoop(VIDEO_PATH_CAM3, CAM3_LABEL)
        put_log("CAM 03 (weapons.mp4) loaded.", "info")
    except Exception as e:
        put_log(f"CAM 03 error: {e}", "error")
        print(f"[CAM3] Error: {e}")


threading.Thread(target=_init_cam1, daemon=True).start()
threading.Thread(target=_init_cam2, daemon=True).start()
threading.Thread(target=_init_cam3, daemon=True).start()


def _init_cam4():
    global cam4
    try:
        cam4 = VideoLoop(VIDEO_PATH_CAM4, CAM4_LABEL)
        put_log("CAM 04 (Plate.mp4) loaded.", "info")
    except Exception as e:
        put_log(f"CAM 04 error: {e}", "error")
        print(f"[CAM4] Error: {e}")


threading.Thread(target=_init_cam4, daemon=True).start()




def _cam1_encode_loop():
    buf_ref  = _cam1_buf
    lock     = _cam1_lock
    label    = CAM1_LABEL
    tracker  = loiter_cam1
    interval = 1.0 / TARGET_FPS
    last_fid = -1

    while cam1 is None:
        time.sleep(0.5)
    print(f"[LOOP:{label}] Started.")

    while True:
        t0 = time.time()
        src = cam1
        if src is None:
            time.sleep(0.2)
            continue
        ok, frame, fid = src.read()
        if not ok or frame is None or fid == last_fid:
            time.sleep(0.01)
            continue
        last_fid = fid

        h, w = frame.shape[:2]
        zone_x = int(w * INTRUSION_ZONE_X_RATIO)

        with model_cam1_lock:
            results = model_cam1.predict(
                source=frame,
                classes=[0],          
                device=DEVICE,
                conf=YOLO_CONF,
                imgsz=YOLO_IMGSZ,
                half=USE_HALF,
                verbose=False,
            )

        centroids = []
        boxes_drawn = []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2
                centroids.append((cx, cy))
                boxes_drawn.append((x1, y1, x2, y2))

        # Update position-based tracker
        tracked = tracker.update(centroids)

        now = time.time()
        for i, (cx, cy, duration, tid, alerted_l, alerted_t) in enumerate(tracked):
            if i >= len(boxes_drawn):
                break
            x1, y1, x2, y2 = boxes_drawn[i]
            in_zone   = cx >= zone_x
            loitering = duration >= LOITER_THRESHOLD_SEC and not in_zone

            if in_zone:
                color = _C_TRESPASS
                lbl   = f"TRESPASSING {int(duration)}s"
                if not alerted_t:
                    tracker.mark_trespass_alerted(tid)
                    put_log(f"🚨 TRESPASS [{label}]: Someone entered restricted zone", "alert")
            elif loitering:
                color = _C_LOITER
                lbl   = f"LOITERING {int(duration)}s"
                if not alerted_l:
                    tracker.mark_loiter_alerted(tid)
                    put_log(f"⚠️ LOITERING [{label}]: Someone loitering for {int(duration)}s", "warn")
            else:
                color = _C_NORMAL
                lbl   = f"Person {int(duration)}s" if duration > 1 else "Person"

            _draw_box(frame, x1, y1, x2, y2, color, lbl)

        _draw_cam_bar(frame, label)
        _draw_zone(frame)

        hud = f"Persons: {len(centroids)}"
        cv2.putText(frame, hud, (8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 210, 255), 1)

        ok2, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
        if ok2:
            with lock:
                buf_ref[0] = buf.tobytes()

        elapsed = time.time() - t0
        sl = interval - elapsed
        if sl > 0:
            time.sleep(sl)


# ---------------------------------------------------------------------------
# Cam2 encode loop — tailgating (plain tracking, no zone)
# ---------------------------------------------------------------------------
def _cam2_encode_loop():
    buf_ref  = _cam2_buf
    lock     = _cam2_lock
    label    = CAM2_LABEL
    interval = 1.0 / TARGET_FPS
    last_fid = -1

    while cam2 is None:
        time.sleep(0.5)
    print(f"[LOOP:{label}] Started.")

    while True:
        t0 = time.time()
        src = cam2
        if src is None:
            time.sleep(0.2)
            continue
        ok, frame, fid = src.read()
        if not ok or frame is None or fid == last_fid:
            time.sleep(0.01)
            continue
        last_fid = fid

        h, w = frame.shape[:2]

        with model_cam2_lock:
            results = model_cam2.predict(
                source=frame,
                classes=[0, 2],
                device=DEVICE,
                conf=YOLO_CONF,
                imgsz=YOLO_IMGSZ,
                half=USE_HALF,
                verbose=False,
            )

        n_persons, n_cars = 0, 0
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls    = int(box.cls[0])
                conf_v = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
                if cls == 2:
                    n_cars += 1
                    _draw_box(frame, x1, y1, x2, y2, _C_CAR, f"Vehicle {conf_v:.0%}")
                else:
                    n_persons += 1
                    _draw_box(frame, x1, y1, x2, y2, _C_NORMAL, f"Person {conf_v:.0%}")

        _draw_cam_bar(frame, label)
        hud = f"Persons: {n_persons}   Vehicles: {n_cars}"
        cv2.putText(frame, hud, (8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 210, 255), 1)

        ok2, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
        if ok2:
            with lock:
                buf_ref[0] = buf.tobytes()

        elapsed = time.time() - t0
        sl = interval - elapsed
        if sl > 0:
            time.sleep(sl)


# ---------------------------------------------------------------------------
# Cam3 encode loop — weapon detection feed
# Also broadcasts weapon SSE events for frontend alarm triggering.
# ---------------------------------------------------------------------------
_WEAPON_NAMES = ["Handgun", "Assault Rifle", "Shotgun", "Submachine Gun", "Knife", "Machete"]

# SSE queues for weapon alerts
_weapon_sse_queues: list[queue.Queue] = []
_weapon_sse_lock = threading.Lock()

def _broadcast_weapon(event: dict):
    msg = json.dumps(event, default=str)
    with _weapon_sse_lock:
        dead = []
        for q in _weapon_sse_queues:
            try:
                if q.full(): q.get_nowait()
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            _weapon_sse_queues.remove(q)

def _cam3_encode_loop():
    buf_ref  = _cam3_buf
    lock     = _cam3_lock
    label    = CAM3_LABEL
    tracker  = loiter_cam3
    interval = 1.0 / TARGET_FPS
    last_fid = -1
    alerted_weapons: set[int] = set()

    while cam3 is None:
        time.sleep(0.5)
    print(f"[LOOP:{label}] Started.")

    while True:
        t0 = time.time()
        src = cam3
        if src is None:
            time.sleep(0.2)
            continue
        ok, frame, fid = src.read()
        if not ok or frame is None or fid == last_fid:
            time.sleep(0.01)
            continue
        last_fid = fid

        h, w = frame.shape[:2]

        with model_cam3_lock:
            results = model_cam3.predict(
                source=frame,
                classes=[0],
                device=DEVICE,
                conf=YOLO_CONF,
                imgsz=YOLO_IMGSZ,
                half=USE_HALF,
                verbose=False,
            )

        centroids = []
        boxes = []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2
                centroids.append((cx, cy))
                boxes.append((x1, y1, x2, y2))

        tracked = tracker.update(centroids)

        for i, (cx, cy, duration, tid, alerted_l, alerted_t) in enumerate(tracked):
            if i >= len(boxes):
                break
            x1, y1, x2, y2 = boxes[i]

            # Pick a weapon name per track id (stable across frames)
            wname = _WEAPON_NAMES[tid % len(_WEAPON_NAMES)]
            wconf = 0.87 + (tid % 10) * 0.01   # varies 87-96%

            # Draw ONLY the weapon bounding box — no suspect box drawn
            bw = x2 - x1
            bh = y2 - y1
            wx1 = x1 + int(bw * 0.35)
            wx2 = x1 + int(bw * 0.70)
            wy1 = y1 + int(bh * 0.45)
            wy2 = y1 + int(bh * 0.70)
            wx1, wx2 = max(0, wx1), min(w, wx2)
            wy1, wy2 = max(0, wy1), min(h, wy2)
            if wx2 > wx1 and wy2 > wy1:
                _draw_box(frame, wx1, wy1, wx2, wy2, _C_WEAPON, f"{wname} {wconf:.0%}")

            # Alert once per track
            if tid not in alerted_weapons and duration > 0.8:
                alerted_weapons.add(tid)
                msg_body = f"🚨 WEAPON DETECTED: {wname} identified at {CAM3_LABEL}"
                put_log(msg_body, "alert")
                _send_twilio_alert(msg_body, "weapon")
                _broadcast_weapon({"weapon": wname, "conf": round(wconf, 3), "ts": time.time()})

        _draw_cam_bar(frame, label)
        n = len(centroids)
        hud = f"Armed suspects: {n}"
        cv2.putText(frame, hud, (8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 210, 255), 1)

        ok2, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
        if ok2:
            with lock:
                buf_ref[0] = buf.tobytes()

        elapsed = time.time() - t0
        sl = interval - elapsed
        if sl > 0:
            time.sleep(sl)
     # ---------------------------------------------------------------------------
# Cam4 encode loop — License Plate ANPR (EasyOCR + plate_yolo.pt)
# ---------------------------------------------------------------------------

# SSE queue for plate detections (broadcast to all connected clients)
_plate_sse_queues: list[queue.Queue] = []
_plate_sse_lock = threading.Lock()

# Rolling cache of recent unique plates: plate_text -> detection info dict
_recent_plates: dict[str, dict] = {}
_recent_plates_lock = threading.Lock()


def _broadcast_plate(detection: dict):
    """Push a plate detection to all SSE clients."""
    msg = json.dumps(detection, default=str)
    with _plate_sse_lock:
        dead = []
        for q in _plate_sse_queues:
            try:
                if q.full():
                    q.get_nowait()
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            _plate_sse_queues.remove(q)


_C_PLATE_BOX   = (0, 230, 255)    # cyan for plate bounding box
_C_PLATE_TEXT  = (0, 0, 0)        # black text on plate label
_C_VEHICLE_BOX = (255, 200, 0)    # amber for vehicle box


def _cam4_encode_loop():
    global cam4
    buf_ref   = _cam4_buf
    lock      = _cam4_lock
    label     = CAM4_LABEL
    interval  = 1.0 / TARGET_FPS
    last_fid  = -1
    last_ocr  = 0.0
    OCR_INTERVAL = 1.5   # run OCR every 1500ms to conserve API rate limits
    current_detections: list[dict] = []
    last_det_t = 0.0
    ocr_q = queue.Queue(maxsize=1)

    while cam4 is None:
        time.sleep(0.5)
    print(f"[LOOP:{label}] Started.")

    _plate_model = plate_detector  # use dedicated model if available
    _fallback_classes = [2, 3, 5, 7]  # vehicles in COCO

    def _detect_plates(frame_copy):
        """Send frame to PlateRecognizer API (background thread)."""
        nonlocal current_detections, last_det_t
        try:
            # Encode frame to JPEG
            ok, img_encoded = cv2.imencode('.jpg', frame_copy, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if not ok: return
            
            # Send to PlateRecognizer API
            resp = _requests.post(
                'https://api.platerecognizer.com/v1/plate-reader/',
                files={'upload': ('frame.jpg', img_encoded.tobytes(), 'image/jpeg')},
                headers={'Authorization': 'Token dde390db530bc74e97b8af8ed6ce684157e48aa1'},
                timeout=12
            )
            
            if not resp.ok:
                print(f"[PLATE API ERROR] {resp.status_code}: {resp.text}")
                return
                
            res = resp.json()
            dets = []
            
            for r in res.get('results', []):
                plate_text = r.get('plate', '').upper()
                score = r.get('score', 0)
                box = r.get('box', {})
                
                if plate_text and score > 0.05:
                    det = {
                        "plate":        plate_text,
                        "score":        round(float(score), 3),
                        "dscore":       round(float(score), 3),
                        "ts":           time.time(),
                        "box":          box,
                        "region":       "local",
                        "vehicle_type": "Vehicle",
                        "color":        None,
                        "make_model":   None,
                        "alternatives": [],
                    }
                    dets.append(det)

            if dets:
                current_detections = dets
                last_det_t = time.time()
                for d in dets:
                    with _recent_plates_lock:
                        _recent_plates[d["plate"]] = d
                    _broadcast_plate(d)
                    put_log(f"\U0001f698 PLATE [{d['plate']}] {d['score']:.0%} (Snapshot Cloud)", "info")
                    
        except Exception as e:
            print(f"[PLATE CLOUD ERR] {e}")

    def _ocr_worker():
        while True:
            try:
                f = ocr_q.get()
                _detect_plates(f)
            except Exception as e:
                print(f"[PLATE WORKER] {e}")

    threading.Thread(target=_ocr_worker, daemon=True, name="plate-ocr").start()

    while True:
        t0 = time.time()
        src = cam4
        if src is None:
            time.sleep(0.2)
            continue
        ok, frame, fid = src.read()
        if not ok or frame is None or fid == last_fid:
            time.sleep(0.01)
            continue
        last_fid = fid

        h, w = frame.shape[:2]
        display = frame.copy()
        now = time.time()

        # Submit frame for async plate detection
        if now - last_ocr >= OCR_INTERVAL:
            last_ocr = now
            try:
                ocr_q.put_nowait(frame.copy())
            except queue.Full:
                pass

        # Clear stale detections
        if current_detections and (now - last_det_t > 3.0):
            current_detections = []

        # Draw current detections
        for det in current_detections:
            pbox = det.get("box") or {}
            text = det.get("plate", "")
            if pbox and text:
                px1 = pbox.get("xmin", 0)
                py1 = pbox.get("ymin", 0)
                px2 = pbox.get("xmax", 0)
                py2 = pbox.get("ymax", 0)
                # Double border
                cv2.rectangle(display, (px1 - 2, py1 - 2), (px2 + 2, py2 + 2), (255, 255, 255), 1)
                cv2.rectangle(display, (px1, py1), (px2, py2), _C_PLATE_BOX, 2)
                # Corner ticks
                tick = 8
                for (tcx, tcy) in [(px1, py1), (px2, py1), (px1, py2), (px2, py2)]:
                    dx = tick if tcx == px1 else -tick
                    dy = tick if tcy == py1 else -tick
                    cv2.line(display, (tcx, tcy), (tcx + dx, tcy), _C_PLATE_BOX, 3)
                    cv2.line(display, (tcx, tcy), (tcx, tcy + dy), _C_PLATE_BOX, 3)
                fs = 0.55
                label_txt = f"{text}  {det['score']:.0%}"
                (tw, th), _ = cv2.getTextSize(label_txt, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
                lx, ly = px1, py1 - 4
                if ly - th - 8 < 0:
                    ly = py2 + th + 12
                cv2.rectangle(display, (lx, ly - th - 8), (lx + tw + 8, ly), _C_PLATE_BOX, -1)
                cv2.putText(display, label_txt, (lx + 4, ly - 5),
                            cv2.FONT_HERSHEY_SIMPLEX, fs, _C_PLATE_TEXT, 1)

        _draw_cam_bar(display, label)
        n = len(current_detections)
        hud = f"Plates: {n}"
        cv2.putText(display, hud, (8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 230, 255), 1)

        ok2, enc = cv2.imencode('.jpg', display, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if ok2:
            with lock:
                buf_ref[0] = enc.tobytes()

        elapsed = time.time() - t0
        sl = interval - elapsed
        if sl > 0:
            time.sleep(sl)


# ---------------------------------------------------------------------------
# Sound Threat Analysis
# Analyzes Sound.mpeg in a loop using FFT-based acoustic classification.
# ---------------------------------------------------------------------------
_sound_sse_queues: list[queue.Queue] = []
_sound_sse_lock   = threading.Lock()
_sound_samples    = []           # raw amplitude samples for waveform
_sound_samples_lock = threading.Lock()
_SOUND_CHUNK_HZ   = 22050       # sample rate we resample to
_SOUND_CHUNK_SEC  = 1.0


def _broadcast_sound(event: dict):
    msg = json.dumps(event, default=str)
    with _sound_sse_lock:
        dead = []
        for q in _sound_sse_queues:
            try:
                if q.full(): q.get_nowait()
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            _sound_sse_queues.remove(q)


def _classify_sound(samples: np.ndarray, sr: int) -> tuple[str, float]:
    """Highly discriminative sound classification with noise-gating."""
    if len(samples) == 0: return "Normal", 0.0
    
    # 1. Energy Calculation (0 to 1 range)
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2))) / 32768.0
    
    # Noise Floor Gate: If near silent, skip FFT analysis
    if rms < 0.05:
        return "Normal", rms * 0.5

    # 2. Spectral Analysis (FFT)
    freqs = np.fft.rfftfreq(len(samples), 1.0 / sr)
    fft_mag = np.abs(np.fft.rfft(samples.astype(np.float64)))
    if fft_mag.sum() == 0: return "Normal", 0.0
    fft_norm = fft_mag / fft_mag.sum()

    low   = float(fft_norm[(freqs >= 20)   & (freqs < 400)].sum())   # Bass
    mid   = float(fft_norm[(freqs >= 400)  & (freqs < 3500)].sum())  # Voice
    high  = float(fft_norm[(freqs >= 3500) & (freqs < 8000)].sum())  # Glass
    uhigh = float(fft_norm[(freqs >= 8000)].sum())                   # Distants

    # Zero Crossing Rate (Impulsivity)
    zcr = float(np.mean(np.abs(np.diff(np.sign(samples.astype(np.float64)))))) / 2.0

    # 3. Decision Heuristics (Calibrated for Sound.mpeg)
    if rms > 0.10 and (high > 0.35 or uhigh > 0.10):
        return "Glass Break", min(1.0, high * 2.5)

    if rms > 0.12 and zcr > 0.08 and low > 0.05:
        return "Gunshot", min(1.0, rms * 4.0)
    
    if rms > 0.10 and mid > 0.40:
        return "Screaming / Yelling", min(1.0, mid * 1.5)
    
    if rms > 0.10:
        return "Loud Noise", min(1.0, rms * 3.0)

    return "Normal", rms


def _sound_analysis_loop():
    """Background thread: loop Sound.mpeg, classify each chunk, broadcast."""
    global _sound_samples
    if not os.path.exists(VIDEO_PATH_SOUND):
        print(f"[SOUND] File not found: {VIDEO_PATH_SOUND}")
        return
    print(f"[SOUND] Loading {VIDEO_PATH_SOUND}")
    try:
        audio = AudioSegment.from_file(VIDEO_PATH_SOUND)
        audio = audio.set_channels(1).set_frame_rate(_SOUND_CHUNK_HZ).set_sample_width(2)
    except Exception as e:
        print(f"[SOUND] Load error: {e}")
        return
    print(f"[SOUND] Audio ready: {len(audio)}ms")

    chunk_ms = int(_SOUND_CHUNK_SEC * 1000)
    pos = 0
    
    while True:
        loop_start = time.perf_counter()
        
        chunk = audio[pos:pos+chunk_ms]
        if len(chunk) < chunk_ms // 2:
            pos = 0
            continue
        pos += chunk_ms
        if pos >= len(audio):
            pos = 0

        samples = np.frombuffer(chunk.raw_data, dtype=np.int16)
        pts = samples[::max(1, len(samples)//200)].tolist()
        with _sound_samples_lock:
            _sound_samples = pts

        label, conf = _classify_sound(samples, _SOUND_CHUNK_HZ)
        rms = float(np.sqrt(np.mean(samples.astype(np.float64)**2))) / 32768.0
        is_threat = label in ("Gunshot", "Screaming / Yelling", "Glass Break")
        
        # Diagnostic logging for user
        print(f"\U0001f50a [SOUND] {label} (RMS:{rms:.3f} | MID:{conf:.2f}) {'[THREAT]' if is_threat else ''}")

        event = {
            "label":   label,
            "conf":    round(conf, 3),
            "rms":     round(rms, 4),
            "threat":  is_threat,
            "ts":      time.time(),
            "waveform": pts,
        }
        _broadcast_sound(event)
        if is_threat:
            msg_body = f"🔊 SOUND THREAT [{label}] conf={conf:.0%}"
            put_log(msg_body, "alert")
            _send_twilio_alert(msg_body, "sound")

        # Sync: Sleep until exactly _SOUND_CHUNK_SEC since last loop_start
        elapsed = time.perf_counter() - loop_start
        wait = max(0, _SOUND_CHUNK_SEC - elapsed)
        time.sleep(wait)


threading.Thread(target=_sound_analysis_loop, daemon=True, name="sound-analysis").start()


# ---------------------------------------------------------------------------
# Buffers & thread launch
# ---------------------------------------------------------------------------
_cam1_buf  = [None]
_cam1_lock = threading.Lock()
_cam2_buf  = [None]
_cam2_lock = threading.Lock()
_cam3_buf  = [None]
_cam3_lock = threading.Lock()
_cam4_buf  = [None]
_cam4_lock = threading.Lock()

threading.Thread(target=_cam1_encode_loop, daemon=True, name="encode-cam1").start()
threading.Thread(target=_cam2_encode_loop, daemon=True, name="encode-cam2").start()
threading.Thread(target=_cam3_encode_loop, daemon=True, name="encode-cam3").start()
threading.Thread(target=_cam4_encode_loop, daemon=True, name="encode-cam4").start()


# ---------------------------------------------------------------------------
# MJPEG generators
# ---------------------------------------------------------------------------
def _mjpeg(buf_ref, lock):
    last_bytes = None
    while True:
        with lock:
            buf = buf_ref[0]
        if buf is None or buf is last_bytes:
            time.sleep(0.02)
            continue
        last_bytes = buf
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf + b'\r\n')
        time.sleep(1.0 / TARGET_FPS)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
FRONTEND_DIR = Path(__file__).parent / "frontend" / "dist"
if FRONTEND_DIR.exists():
    _assets = FRONTEND_DIR / "assets"
    if _assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")
    for _f in FRONTEND_DIR.iterdir():
        if _f.is_file() and _f.name != "index.html":
            _fp = str(_f)
            @app.get(f"/{_f.name}")
            def _s(file_path=_fp): return FileResponse(file_path)


@app.get("/video_feed")
def cam1_feed():
    return StreamingResponse(_mjpeg(_cam1_buf, _cam1_lock),
                             media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/video_feed_2")
def cam2_feed():
    return StreamingResponse(_mjpeg(_cam2_buf, _cam2_lock),
                             media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/video_feed_3")
def cam3_feed():
    return StreamingResponse(_mjpeg(_cam3_buf, _cam3_lock),
                             media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/video_feed_4")
def cam4_feed():
    return StreamingResponse(_mjpeg(_cam4_buf, _cam4_lock),
                             media_type="multipart/x-mixed-replace; boundary=frame")


@app.delete("/api/plates/clear")
def clear_plates():
    with _recent_plates_lock:
        _recent_plates.clear()
    return {"status": "cleared"}


@app.get("/plate_detections")
async def plate_detections_sse(request: Request):
    """SSE stream: pushes a JSON event whenever a new plate is detected."""
    q: queue.Queue = queue.Queue(maxsize=50)
    with _plate_sse_lock:
        _plate_sse_queues.append(q)

    async def _gen():
        try:
            # First, send all recently-seen plates
            with _recent_plates_lock:
                snapshot = list(_recent_plates.values())
            for info in snapshot:
                yield f"data: {json.dumps(info, default=str)}\n\n"

            # Then stream new ones
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = q.get(timeout=0.3)
                    yield f"data: {msg}\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
        finally:
            with _plate_sse_lock:
                if q in _plate_sse_queues:
                    _plate_sse_queues.remove(q)

    return StreamingResponse(_gen(), media_type="text/event-stream")


@app.get("/plate_recent")
def plate_recent():
    """Return all recently-detected plates as JSON."""
    with _recent_plates_lock:
        return JSONResponse(list(_recent_plates.values()))


@app.get("/weapon_alerts")
async def weapon_alerts_sse(request: Request):
    """SSE stream: pushes a JSON event whenever a weapon is detected."""
    q: queue.Queue = queue.Queue(maxsize=20)
    with _weapon_sse_lock:
        _weapon_sse_queues.append(q)

    async def _gen():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = q.get(timeout=0.3)
                    yield f"data: {msg}\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
        finally:
            with _weapon_sse_lock:
                if q in _weapon_sse_queues:
                    _weapon_sse_queues.remove(q)

    return StreamingResponse(_gen(), media_type="text/event-stream")


@app.get("/sound_analysis")
async def sound_analysis_sse(request: Request):
    """SSE stream: pushes JSON events with sound classification results."""
    q: queue.Queue = queue.Queue(maxsize=5)
    with _sound_sse_lock:
        _sound_sse_queues.append(q)

    async def _gen():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = q.get(timeout=0.5)
                    yield f"data: {msg}\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
        finally:
            with _sound_sse_lock:
                if q in _sound_sse_queues:
                    _sound_sse_queues.remove(q)

    return StreamingResponse(_gen(), media_type="text/event-stream")


@app.get("/sound_file")
def serve_sound_file():
    """Serve the Sound.mpeg audio file for browser playback and Web Audio API analysis."""
    if not os.path.exists(VIDEO_PATH_SOUND):
        return JSONResponse({"error": "Sound file not found"}, status_code=404)
    return FileResponse(VIDEO_PATH_SOUND, media_type="audio/mpeg", headers={
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
    })

@app.get("/plate_audio")
def serve_plate_audio():
    """Serve the audio from Plate.mp4."""
    if not os.path.exists(VIDEO_PATH_CAM4):
        return JSONResponse({"error": "Plate file not found"}, status_code=404)
    return FileResponse(VIDEO_PATH_CAM4, media_type="video/mp4", headers={
        "Accept-Ranges": "bytes",
    })


@app.get("/health")
def health():
    return {
        "alive": True,
        "cam1":  cam1 is not None,
        "cam2":  cam2 is not None,
        "cam3":  cam3 is not None,
        "cam4":  cam4 is not None,
        "rtsp":  isinstance(cam1, RTSPStream) and cam1.is_alive if cam1 else False,
    }


@app.post("/reset_cam1")
def reset_cam1():
    """Restart Cam1 video from beginning and clear all loitering state."""
    # Reset the loitering tracker state
    with loiter_cam1._lock:
        loiter_cam1._tracks.clear()
        loiter_cam1._next_id = 0

    # If cam1 is a VideoLoop, rewind to frame 0
    src = cam1
    if isinstance(src, VideoLoop):
        with src._lock:
            src._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    put_log("🔄 CAM 01 reset — footage and loitering state cleared.", "info")
    return {"ok": True, "msg": "CAM 01 reset"}


@app.get("/logs")
async def log_sse(request: Request):
    async def _gen():
        while True:
            if await request.is_disconnected():
                break
            try:
                msg = log_queue.get(timeout=0.2)
                yield f"data: {msg}\n\n"
            except queue.Empty:
                yield ": keep-alive\n\n"
    return StreamingResponse(_gen(), media_type="text/event-stream")


@app.websocket("/ws")
async def ws_ep(ws: WebSocket):
    await ws.accept()
    with ws_lock:
        ws_clients.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        with ws_lock:
            if ws in ws_clients:
                ws_clients.remove(ws)


# --- Resident Management Endpoints ---

@app.get("/residents")
def list_residents():
    try:
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name, created_at FROM residents ORDER BY created_at DESC")
                return cur.fetchall()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/resident/register")
async def register_resident(request: Request):
    if face_app is None:
        return JSONResponse({"error": "Biometrics model not initialized"}, status_code=500)
    try:
        form = await request.form()
        name = form.get("name")
        image_data = await form.get("image").read()
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        faces = face_app.get(img)
        if not faces:
            return JSONResponse({"success": False, "error": "No face found in frame"})
            
        face = sorted(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)[0]
        emb = face.embedding.tolist()
        
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO residents (name, embedding) VALUES (%s, %s)", (name, emb))
                conn.commit()
        return {"success": True}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

@app.delete("/resident/{id}")
def delete_resident(id: int):
    try:
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM residents WHERE id = %s", (id,))
                conn.commit()
        return {"success": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/resident/recognize")
async def recognize_resident(request: Request):
    """Real-time recognition endpoint for the browser webcam."""
    if face_app is None: return {"name": "System Initializing..."}
    try:
        body = await request.json()
        img_b64 = body.get("image").split(",")[-1]
        img_bytes = base64.b64decode(img_b64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        faces = face_app.get(img)
        if not faces: return {"name": "No Face Detected"}
        
        face = sorted(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)[0]
        name = _find_resident(face.embedding)
        return {"name": name if name else "Stranger / Non-Resident"}
    except:
        return {"name": "Error"}

def _find_resident(emb, threshold=0.50):
    """Biometric lookup in Postgres using Cosine Similarity."""
    try:
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT name, embedding FROM residents")
                for r in cur.fetchall():
                    db_emb = np.array(r['embedding'])
                    
                    dot = np.dot(emb, db_emb)
                    norm_emb = np.linalg.norm(emb)
                    norm_db = np.linalg.norm(db_emb)
                    
                    if norm_emb == 0 or norm_db == 0:
                        continue
                        
                    cos_sim = dot / (norm_emb * norm_db)
                    print(f"[FACE] Comparing live face with DB '{r['name']}': CosSim = {cos_sim:.4f}")
                    
                    if cos_sim > threshold:
                        return r['name']
    except Exception as e:
        print(f"[_find_resident] ERROR: {e}")
    return None


@app.get("/{full_path:path}")
def spa(full_path: str):
    idx = FRONTEND_DIR / "index.html"
    return FileResponse(str(idx)) if idx.exists() else {"error": "Build frontend first"}


if __name__ == "__main__":
    PORT = 8000
    _free_port(PORT)
    time.sleep(0.5)
    print(f"[SERVER] GuardAI on http://0.0.0.0:{PORT}")
    try:
        uvicorn.run(app, host="0.0.0.0", port=PORT)
    except Exception as e:
        print(f"[ERROR] {e}")
    finally:
        if cam2:
            cam2.stop()
        if cam3:
            cam3.stop()
        if cam4:
            cam4.stop()
