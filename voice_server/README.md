# Voice Server (PersonaPlex-7B)

This server provides a local WebSocket endpoint for voice interviewer audio.
It is optional; if not running, the web app falls back to text-only questions.

## Setup

```bash
cd voice_server
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

## Model access

PersonaPlex is gated. You must accept the license and login:

```bash
huggingface-cli login
```

Set the model ID (optional):

```bash
set PERSONAPLEX_MODEL=nvidia/personaplex-7b-v1
```

## Run (mock mode)

Mock mode returns a short beep for audio. This is useful for UI testing without GPU:

```bash
set PERSONAPLEX_MOCK=1
uvicorn main:app --host 127.0.0.1 --port 8008
```

## Run (GPU mode)

```bash
set PERSONAPLEX_MOCK=0
uvicorn main:app --host 127.0.0.1 --port 8008
```

If no NVIDIA GPU is detected, the server raises an error.

## Proxy mode (Option A: official PersonaPlex/Moshi server)

If you are running the official PersonaPlex/Moshi server, this proxy can
forward audio to it and stream audio/text back to the web app.

1) Start the official server (see the NVIDIA PersonaPlex repo for setup).
   It typically exposes a WebSocket at `ws://127.0.0.1:8998/api/chat`.

2) Run this proxy with a server URL:

```bash
set PERSONAPLEX_PROXY_URL=ws://127.0.0.1:8998/api/chat
uvicorn main:app --host 127.0.0.1 --port 8008
```

Notes:
- You can also use `MOSHI_SERVER_URL` instead of `PERSONAPLEX_PROXY_URL`.
- If your official server uses HTTPS with a self-signed cert, set:
  `set MOSHI_INSECURE=1`
- The proxy expects 16kHz PCM input from the browser and resamples to 24kHz for
  the official server.

## Protocol

WebSocket endpoint: `ws://127.0.0.1:8008/ws`

Client -> Server:
- `{ "type": "hello", "sessionId": "...", "lang": "en"|"ru", "mode": "interviewer" }`
- `{ "type": "context", "role": "...", "level": "...", "topic": "...", "previous": [...] }`
- `{ "type": "audio", "format": "pcm16", "sampleRate": 16000, "channels": 1, "data": "<base64>" }`
- `{ "type": "end_utterance" }`
- `{ "type": "reset" }`

Server -> Client:
- `{ "type": "ready" }`
- `{ "type": "audio_out", "format": "pcm16", "sampleRate": 16000, "channels": 1, "data": "<base64>" }`
- `{ "type": "text_out", "text": "..." }`
- `{ "type": "error", "message": "..." }`

## Notes

- The current `personaplex_runner.py` includes a mock response and placeholder
  for real PersonaPlex audio generation. Integrate the official NVIDIA pipeline
  for full quality voice generation.
