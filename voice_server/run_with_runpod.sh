#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f "venv/bin/activate" ]]; then
  echo "Missing virtualenv at voice_server/venv. Create it first:"
  echo "  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

source venv/bin/activate

# If this script runs inside a Runpod pod, default to local Moshi and public bind.
if [[ -n "${RUNPOD_POD_ID:-}" ]]; then
  DEFAULT_MOSHI_URL="http://127.0.0.1:8998"
  DEFAULT_VOICE_HOST="0.0.0.0"
else
  DEFAULT_MOSHI_URL=""
  DEFAULT_VOICE_HOST="127.0.0.1"
fi

RUNPOD_MOSHI_URL="${RUNPOD_MOSHI_URL:-$DEFAULT_MOSHI_URL}"
if [[ -z "$RUNPOD_MOSHI_URL" ]]; then
  # Fallback: if local Moshi is reachable, use it automatically.
  if curl -sS -m 2 -I "http://127.0.0.1:8998/api/chat" >/dev/null 2>&1; then
    RUNPOD_MOSHI_URL="http://127.0.0.1:8998"
  fi
fi
if [[ -z "$RUNPOD_MOSHI_URL" ]]; then
  echo "Missing RUNPOD_MOSHI_URL."
  echo "Example:"
  echo '  RUNPOD_MOSHI_URL="https://hgv5a7g31d6jit-8998.proxy.runpod.net" ./run_with_runpod.sh'
  exit 1
fi

if [[ "$RUNPOD_MOSHI_URL" != http://* && "$RUNPOD_MOSHI_URL" != https://* ]]; then
  echo "RUNPOD_MOSHI_URL must start with http:// or https://"
  echo "Current value: $RUNPOD_MOSHI_URL"
  exit 1
fi

VOICE_PROMPT="${VOICE_PROMPT:-NATF2.pt}"
TEXT_PROMPT="${TEXT_PROMPT:-You are a wise and friendly teacher. Ask one short interview question.}"
ENCODED_TEXT_PROMPT="$(TEXT_PROMPT="$TEXT_PROMPT" python - <<'PY'
import os, urllib.parse
print(urllib.parse.quote(os.environ["TEXT_PROMPT"]))
PY
)"

HEALTH_URL="${RUNPOD_MOSHI_URL%/}/api/chat"
if ! curl -sS -m 10 -I "$HEALTH_URL" >/dev/null; then
  echo "Cannot reach Runpod Moshi endpoint: $HEALTH_URL"
  echo "Check pod status and HTTP service 8998 readiness in Runpod UI."
  exit 1
fi

export PERSONAPLEX_PROXY_URL="${RUNPOD_MOSHI_URL%/}/api/chat?voice_prompt=${VOICE_PROMPT}&text_prompt=${ENCODED_TEXT_PROMPT}"
export LOCAL_TTS_PROVIDER="${LOCAL_TTS_PROVIDER:-kokoro}"
export KOKORO_VOICE="${KOKORO_VOICE:-af_heart}"
export KOKORO_SPEED="${KOKORO_SPEED:-0.95}"
VOICE_SERVER_HOST="${VOICE_SERVER_HOST:-$DEFAULT_VOICE_HOST}"
VOICE_SERVER_PORT="${VOICE_SERVER_PORT:-8008}"

echo "Using PERSONAPLEX_PROXY_URL=$PERSONAPLEX_PROXY_URL"
echo "Starting voice server on ${VOICE_SERVER_HOST}:${VOICE_SERVER_PORT}"
exec python -m uvicorn main:app --host "$VOICE_SERVER_HOST" --port "$VOICE_SERVER_PORT"
