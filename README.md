# Interview Coach (MVP)

Practice interviews with live delivery signals and structured feedback. The app runs entirely in the browser: no raw video or audio is stored, only transcript + aggregated metrics.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Browser requirements

- Chrome recommended (Web Speech API support for live transcription).
- Camera + microphone permissions required to collect delivery signals.

## OpenAI (optional)

The app works without any API keys and uses a mock AI response by default.

To enable OpenAI:

1. Copy `.env.example` to `.env.local`.
2. Add your key:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_TRANSCRIBE_MODEL=whisper-1
NEXT_PUBLIC_VOICE_WS_URL=ws://127.0.0.1:8008/ws
LOCAL_TRANSCRIBE_URL=http://127.0.0.1:8008/transcribe
LOCAL_TTS_URL=http://127.0.0.1:8008/tts
```

## Unified interview API

`POST /api/interview` supports:

- `generate_preview_questions`
- `generate_primary_questions`
- `generate_followups`
- `score_answer`

All request/response payloads are schema-validated with Zod.

`POST /api/interview/transcribe` accepts recorded answer audio (`multipart/form-data`) and returns:

- `{"transcript":"..."}` (schema-validated)

`POST /api/interview/repeat-tts` accepts repeat text and returns local TTS audio metadata:

- `{"audio_base64":"...","format":"wav","sample_rate":24000}` (schema-validated)

Transcription source priority:

1. `LOCAL_TRANSCRIBE_URL` (free local STT, recommended for Firefox)
2. OpenAI audio transcription (`OPENAI_API_KEY`)

Repeat TTS source priority:

1. `LOCAL_TTS_URL` (Kokoro on `voice_server`, recommended)
2. No browser fallback. If Kokoro is unavailable, repeat TTS is disabled and shows an error.

## Realtime behavior

- Voice websocket endpoint: `NEXT_PUBLIC_VOICE_WS_URL` (default `ws://127.0.0.1:8008/ws`)
- Client uses a connection state machine (`connecting`, `connected`, `reconnecting`, `offline`, `error`)
- Reconnect uses exponential backoff + jitter with max retry cap
- Heartbeat keepalive is sent on the websocket and dead connections are recycled
- Outbound websocket messages are queued while disconnected and flushed in order after reconnect
- If realtime coach delivery is unavailable, the app falls back to HTTP question generation via `/api/interview`

## Runpod remote backend

If `voice_server` runs on Runpod, set:

```bash
NEXT_PUBLIC_VOICE_WS_URL=wss://<YOUR-POD>-8008.proxy.runpod.net/ws
LOCAL_TRANSCRIBE_URL=https://<YOUR-POD>-8008.proxy.runpod.net/transcribe
LOCAL_TTS_URL=https://<YOUR-POD>-8008.proxy.runpod.net/tts
```

And keep an SSH tunnel from your laptop:

```bash
ssh -N -L 8008:127.0.0.1:8008 -p <RUNPOD_TCP_PORT> root@<RUNPOD_TCP_IP>
```

If you expose port `8008` publicly from Runpod, you can set
`NEXT_PUBLIC_VOICE_WS_URL` directly to that public `wss://.../ws` endpoint
instead of using a tunnel.

For quick runtime override without editing env files, open:

`/personaplex?voice_ws=wss://<YOUR-POD>-8008.proxy.runpod.net/ws`

## Demo flow

1. Start on `/` and choose role/level/language.
2. Click **Start interview**.
3. Allow camera/mic permissions.
4. Click **Next question**.
5. Click **Start answer recording**.
6. Click **Stop & evaluate**.
7. After 8 questions, click **Finish interview** to view the report.

## Privacy notes

- Raw video/audio is never stored.
- If browser live transcription misses speech, short answer audio is temporarily sent to `/api/interview/transcribe` and forwarded to OpenAI transcription.
- If repeat TTS is enabled, repeat text is sent to `/api/interview/repeat-tts` to synthesize short local WAV output.
- Only transcript + aggregated metrics are stored in memory unless you toggle "Store session locally".
