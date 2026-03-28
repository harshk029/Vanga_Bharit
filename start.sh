#!/usr/bin/env bash
# ============================================================
# Smart Surveillance — Unified Launcher
# Starts: MediaMTX (RTSP server) → FFmpeg (loop video) → FastAPI
# Usage:  bash start.sh [path/to/video.mp4]
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEO="${1:-/home/apurva/Desktop/final.mp4}"
MEDIAMTX="$SCRIPT_DIR/mediamtx/mediamtx"
RTSP_PORT=8554
RTSP_URL="rtsp://localhost:$RTSP_PORT/live"
FASTAPI_PORT=8000

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

# Cleanup on exit
PIDS=()
cleanup() {
    echo -e "\n${YELLOW}[LAUNCHER] Shutting down...${NC}"
    for pid in "${PIDS[@]}"; do
        kill -9 "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
    echo -e "${GREEN}[LAUNCHER] All processes stopped.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Clean stale processes before starting
echo -e "${YELLOW}[LAUNCHER] Cleaning up stale processes...${NC}"
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 8554/tcp 2>/dev/null || true
pkill -9 -f "mediamtx" 2>/dev/null || true
pkill -9 -f "ffmpeg.*final" 2>/dev/null || true
pkill -9 -f "python main.py" 2>/dev/null || true
sleep 1

# --- Validate ---
if [ ! -f "$VIDEO" ]; then
    echo -e "${RED}[ERROR] Video not found: $VIDEO${NC}"
    exit 1
fi
if [ ! -x "$MEDIAMTX" ]; then
    echo -e "${RED}[ERROR] MediaMTX not found at $MEDIAMTX${NC}"
    echo "Run:  cd mediamtx && wget https://github.com/bluenviron/mediamtx/releases/download/v1.12.2/mediamtx_v1.12.2_linux_amd64.tar.gz -O m.tar.gz && tar xzf m.tar.gz && rm m.tar.gz"
    exit 1
fi

echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   GuardAI — Intelligent Surveillance Platform    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo -e "  Video:   ${GREEN}$VIDEO${NC}"
echo -e "  RTSP:    ${GREEN}$RTSP_URL${NC}"
echo -e "  Web UI:  ${GREEN}http://0.0.0.0:$FASTAPI_PORT/${NC}"
echo ""

# --- 1. Build React frontend if needed ---
if [ -d "$SCRIPT_DIR/frontend" ] && [ ! -d "$SCRIPT_DIR/frontend/dist" ]; then
    echo -e "${YELLOW}[LAUNCHER] Building React frontend...${NC}"
    (cd "$SCRIPT_DIR/frontend" && npm run build)
    echo -e "${GREEN}[LAUNCHER] Frontend built.${NC}"
fi

# --- 2. Start MediaMTX ---
echo -e "${YELLOW}[LAUNCHER] Starting MediaMTX RTSP server on port $RTSP_PORT...${NC}"
"$MEDIAMTX" "$SCRIPT_DIR/mediamtx/mediamtx.yml"  &
PIDS+=($!)
sleep 2
echo -e "${GREEN}[LAUNCHER] MediaMTX running (PID ${PIDS[-1]})${NC}"

# --- 3. Start FFmpeg loop ---
echo -e "${YELLOW}[LAUNCHER] Starting FFmpeg stream → $RTSP_URL${NC}"
ffmpeg \
    -re \
    -stream_loop -1 \
    -i "$VIDEO" \
    -c:v libx264 \
    -preset ultrafast \
    -tune zerolatency \
    -b:v 2500k \
    -maxrate 2500k \
    -bufsize 5000k \
    -g 30 \
    -an \
    -f rtsp \
    -rtsp_transport tcp \
    "$RTSP_URL" \
     &
PIDS+=($!)
sleep 2
echo -e "${GREEN}[LAUNCHER] FFmpeg streaming (PID ${PIDS[-1]})${NC}"

# --- 4. Start FastAPI ---
echo -e "${YELLOW}[LAUNCHER] Starting FastAPI on http://0.0.0.0:$FASTAPI_PORT ...${NC}"
cd "$SCRIPT_DIR"
source venv/bin/activate 2>/dev/null || true
python main.py &
PIDS+=($!)
echo -e "${GREEN}[LAUNCHER] FastAPI running (PID ${PIDS[-1]})${NC}"
echo ""
echo -e "${CYAN}═══ All services started. Press Ctrl+C to stop ═══${NC}"
echo ""

# Wait for any process to exit
wait -n "${PIDS[@]}" 2>/dev/null || true
echo -e "${RED}[LAUNCHER] A process exited unexpectedly. Shutting down.${NC}"
