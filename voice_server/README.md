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
