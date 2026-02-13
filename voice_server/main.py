import asyncio
import base64
import json
import os
from typing import Any, Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from moshi_proxy import MoshiProxy
from personaplex_runner import PersonaPlexRunner

app = FastAPI()


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
        return
    app.state.proxy = None
    app.state.runner = PersonaPlexRunner()


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
