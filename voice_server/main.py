import asyncio
import base64
import json
import os
from typing import Any, Dict

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from moshi_proxy import MoshiProxy
from personaplex_runner import PersonaPlexRunner
from transcriber import LocalTranscriber
from tts_kokoro import LocalKokoroTts

app = FastAPI()


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    voice: str | None = Field(default=None, max_length=64)
    speed: float | None = Field(default=None, ge=0.7, le=1.3)
    lang_code: str | None = Field(default=None, max_length=8)


def _chunk_audio(pcm_bytes: bytes, sample_rate: int, chunk_ms: int = 200):
    bytes_per_sample = 2
    samples_per_chunk = int(sample_rate * (chunk_ms / 1000))
    bytes_per_chunk = samples_per_chunk * bytes_per_sample
    for idx in range(0, len(pcm_bytes), bytes_per_chunk):
        yield pcm_bytes[idx : idx + bytes_per_chunk]


@app.on_event("startup")
def _startup():
    proxy_url = os.getenv("PERSONAPLEX_PROXY_URL") or os.getenv("MOSHI_SERVER_URL")
    if proxy_url:
        app.state.proxy = MoshiProxy(proxy_url)
        app.state.runner = None
    else:
        app.state.proxy = None
        app.state.runner = PersonaPlexRunner()
    app.state.transcriber = LocalTranscriber()
    app.state.tts = LocalKokoroTts()


@app.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...), language: str = Form(default="en")
):
    transcriber: LocalTranscriber | None = getattr(app.state, "transcriber", None)
    if transcriber is None:
        raise HTTPException(status_code=503, detail="Local transcriber is not available.")

    payload = await audio.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Audio payload is empty.")

    try:
        transcript = transcriber.transcribe(payload, language=language)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"transcript": transcript}


@app.post("/tts")
async def synthesize_tts(payload: TtsRequest):
    tts: LocalKokoroTts | None = getattr(app.state, "tts", None)
    if tts is None:
        raise HTTPException(status_code=503, detail="Local TTS is not available.")

    try:
        wav_bytes, sample_rate = tts.synthesize(
            payload.text,
            voice=payload.voice,
            speed=payload.speed,
            lang_code=payload.lang_code,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not wav_bytes:
        raise HTTPException(status_code=500, detail="Kokoro returned empty audio.")

    return {
        "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
        "format": "wav",
        "sample_rate": sample_rate,
    }


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    await ws.send_json({"type": "ready"})

    proxy: MoshiProxy | None = app.state.proxy
    if proxy is not None:
        try:
            await proxy.handle_session(ws)
        except WebSocketDisconnect:
            return
        except Exception as exc:
            await ws.send_json({"type": "error", "message": str(exc)})
        return

    session_audio = bytearray()
    context: Dict[str, Any] = {}

    try:
        while True:
            raw = await ws.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Invalid JSON."})
                continue

            msg_type = message.get("type")
            if msg_type == "hello":
                context.update(
                    {
                        "role": message.get("role") or context.get("role", "candidate"),
                        "level": message.get("level") or context.get("level", ""),
                        "topic": message.get("topic") or context.get("topic", ""),
                        "lang": message.get("lang") or context.get("lang", "en"),
                    }
                )
                await ws.send_json({"type": "ready"})
            elif msg_type == "context":
                context.update(
                    {
                        "role": message.get("role", context.get("role", "candidate")),
                        "level": message.get("level", context.get("level", "")),
                        "topic": message.get("topic", context.get("topic", "")),
                    }
                )
            elif msg_type == "audio":
                data = message.get("data", "")
                try:
                    session_audio.extend(base64.b64decode(data))
                except Exception:
                    await ws.send_json({"type": "error", "message": "Invalid audio payload."})
            elif msg_type == "end_utterance":
                runner: PersonaPlexRunner = app.state.runner
                text, pcm_bytes, sample_rate = runner.generate(context, bytes(session_audio))
                session_audio = bytearray()
                if text:
                    await ws.send_json({"type": "text_out", "text": text})
                for chunk in _chunk_audio(pcm_bytes, sample_rate):
                    await ws.send_json(
                        {
                            "type": "audio_out",
                            "format": "pcm16",
                            "sampleRate": sample_rate,
                            "channels": 1,
                            "data": base64.b64encode(chunk).decode("ascii"),
                        }
                    )
                    await asyncio.sleep(0.03)
            elif msg_type == "reset":
                session_audio = bytearray()
            else:
                await ws.send_json({"type": "error", "message": "Unknown message type."})
    except WebSocketDisconnect:
        return
    except Exception as exc:
        await ws.send_json({"type": "error", "message": str(exc)})
