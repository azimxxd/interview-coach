import asyncio
import base64
import contextlib
import json
import os
import ssl
from typing import Any, Dict, Optional

import numpy as np
import websockets
from fastapi import WebSocketDisconnect

try:
    import sphn
except Exception as exc:  # pragma: no cover - optional dependency
    sphn = None


def _normalize_ws_url(raw_url: str) -> str:
    if raw_url.startswith("ws://") or raw_url.startswith("wss://"):
        return raw_url
    if raw_url.startswith("http://"):
        return "ws://" + raw_url[len("http://") :]
    if raw_url.startswith("https://"):
        return "wss://" + raw_url[len("https://") :]
    return f"ws://{raw_url}"


def _ensure_chat_path(url: str) -> str:
    if "/api/chat" in url:
        return url
    if url.endswith("/"):
        return f"{url}api/chat"
    return f"{url}/api/chat"


def _bytes_to_float32(pcm_bytes: bytes) -> np.ndarray:
    if not pcm_bytes:
        return np.zeros(0, dtype=np.float32)
    ints = np.frombuffer(pcm_bytes, dtype=np.int16)
    return (ints.astype(np.float32) / 32768.0).copy()


def _float32_to_pcm16(arr: np.ndarray) -> bytes:
    if arr.size == 0:
        return b""
    clipped = np.clip(arr, -1.0, 1.0)
    ints = (clipped * 32767.0).astype(np.int16)
    return ints.tobytes()


def _resample_linear(arr: np.ndarray, input_rate: int, output_rate: int) -> np.ndarray:
    if input_rate == output_rate or arr.size == 0:
        return arr
    ratio = output_rate / input_rate
    out_len = int(arr.size * ratio)
    if out_len <= 0:
        return np.zeros(0, dtype=np.float32)
    x_old = np.linspace(0, 1, arr.size, endpoint=False)
    x_new = np.linspace(0, 1, out_len, endpoint=False)
    return np.interp(x_new, x_old, arr).astype(np.float32)


_ALLOWED_FRAME_SIZES = (120, 240, 480, 960, 1920, 2880)


def _next_allowed_frame_size(length: int) -> int:
    for size in _ALLOWED_FRAME_SIZES:
        if length <= size:
            return size
    return _ALLOWED_FRAME_SIZES[-1]


class MoshiProxy:
    def __init__(self, server_url: str) -> None:
        if sphn is None:
            raise RuntimeError(
                "sphn is required for Moshi proxy mode. Install it with "
                "`pip install sphn` in voice_server."
            )
        normalized = _ensure_chat_path(_normalize_ws_url(server_url))
        self.server_url = normalized
        self.sample_rate = int(os.getenv("MOSHI_SAMPLE_RATE", "24000"))
        self.input_rate = int(os.getenv("MOSHI_INPUT_RATE", "16000"))
        self.output_chunk = int(os.getenv("MOSHI_OUTPUT_CHUNK", "1920"))
        self.input_chunk = int(os.getenv("MOSHI_INPUT_CHUNK", "1920"))
        self.insecure = os.getenv("MOSHI_INSECURE", "0") == "1"
        if self.input_chunk not in _ALLOWED_FRAME_SIZES:
            self.input_chunk = 1920

    def _ssl_context(self) -> Optional[ssl.SSLContext]:
        if self.server_url.startswith("wss://"):
            if self.insecure:
                context = ssl.create_default_context()
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
                return context
            return ssl.create_default_context()
        return None

    @staticmethod
    async def _safe_send_json(ws_client, payload: Dict[str, Any]) -> bool:
        try:
            await ws_client.send_json(payload)
            return True
        except WebSocketDisconnect:
            return False
        except Exception:
            # Includes transport-level disconnects surfaced by Uvicorn/Starlette.
            return False

    async def _forward_from_moshi(self, ws_moshi, ws_client, ready_event: asyncio.Event) -> None:
        reader = sphn.OpusStreamReader(self.sample_rate)
        buffered_audio = np.zeros(0, dtype=np.float32)

        async for message in ws_moshi:
            if not isinstance(message, (bytes, bytearray)):
                continue
            if len(message) == 0:
                # End of chunk from server.
                continue
            kind = message[0]
            payload = message[1:]
            if kind == 0:
                # NVIDIA/Kyutai Moshi handshake byte.
                ready_event.set()
                continue
            if kind == 1:
                pcm = self._reader_append(reader, payload)
                if pcm is None or pcm.size == 0:
                    continue
                buffered_audio = (
                    np.concatenate([buffered_audio, pcm]) if buffered_audio.size else pcm
                )
                while buffered_audio.size >= self.output_chunk:
                    chunk = buffered_audio[: self.output_chunk]
                    buffered_audio = buffered_audio[self.output_chunk :]
                    b64 = base64.b64encode(_float32_to_pcm16(chunk)).decode("ascii")
                    if not await self._safe_send_json(
                        ws_client,
                        {
                            "type": "audio_out",
                            "format": "pcm16",
                            "sampleRate": self.sample_rate,
                            "channels": 1,
                            "data": b64,
                        },
                    ):
                        return
            elif kind == 2:
                text = payload.decode("utf-8", errors="ignore")
                if text:
                    if not await self._safe_send_json(
                        ws_client, {"type": "text_out", "text": text}
                    ):
                        return

    async def handle_session(self, ws_client) -> None:
        ssl_context = self._ssl_context()
        async with websockets.connect(
            self.server_url,
            ssl=ssl_context,
            ping_interval=None,
            ping_timeout=None,
            max_size=None,
        ) as ws_moshi:
            writer = sphn.OpusStreamWriter(self.sample_rate)
            buffered_input = np.zeros(0, dtype=np.float32)
            ready_event = asyncio.Event()
            handshake_timeout = float(os.getenv("MOSHI_HANDSHAKE_TIMEOUT", "120"))
            forward_task = asyncio.create_task(
                self._forward_from_moshi(ws_moshi, ws_client, ready_event)
            )

            try:
                try:
                    await asyncio.wait_for(ready_event.wait(), timeout=handshake_timeout)
                except asyncio.TimeoutError:
                    await self._safe_send_json(
                        ws_client,
                        {
                            "type": "error",
                            "message": "PersonaPlex handshake timed out. Check Moshi server logs.",
                        },
                    )
                    return
                if not await self._safe_send_json(ws_client, {"type": "ready"}):
                    return

                while True:
                    if forward_task.done():
                        exc = forward_task.exception()
                        if exc is not None:
                            raise exc
                        return
                    try:
                        raw = await asyncio.wait_for(ws_client.receive_text(), timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    try:
                        message = json.loads(raw)
                    except Exception:
                        if not await self._safe_send_json(
                            ws_client, {"type": "error", "message": "Invalid JSON."}
                        ):
                            return
                        continue

                    msg_type = message.get("type")
                    if msg_type == "audio":
                        payload = message.get("data", "")
                        input_rate = int(message.get("sampleRate") or self.input_rate)
                        try:
                            pcm_bytes = base64.b64decode(payload)
                        except Exception:
                            if not await self._safe_send_json(
                                ws_client,
                                {"type": "error", "message": "Invalid audio payload."},
                            ):
                                return
                            continue
                        pcm = _bytes_to_float32(pcm_bytes)
                        pcm = _resample_linear(pcm, input_rate, self.sample_rate)
                        if pcm.size == 0:
                            continue
                        buffered_input = (
                            np.concatenate([buffered_input, pcm])
                            if buffered_input.size
                            else pcm
                        )
                        while buffered_input.size >= self.input_chunk:
                            chunk = buffered_input[: self.input_chunk]
                            buffered_input = buffered_input[self.input_chunk :]
                            encoded = self._writer_append(writer, chunk)
                            if encoded:
                                try:
                                    await ws_moshi.send(b"\x01" + encoded)
                                except websockets.ConnectionClosed:
                                    return
                    elif msg_type == "reset":
                        writer = sphn.OpusStreamWriter(self.sample_rate)
                        buffered_input = np.zeros(0, dtype=np.float32)
                    elif msg_type == "end_utterance":
                        # Flush remaining buffered PCM in a valid frame size.
                        if buffered_input.size:
                            frame_size = _next_allowed_frame_size(int(buffered_input.size))
                            if buffered_input.size < frame_size:
                                pad = np.zeros(
                                    frame_size - buffered_input.size, dtype=np.float32
                                )
                                chunk = np.concatenate([buffered_input, pad])
                            else:
                                chunk = buffered_input[:frame_size]
                            buffered_input = np.zeros(0, dtype=np.float32)
                            encoded = self._writer_append(writer, chunk)
                            if encoded:
                                try:
                                    await ws_moshi.send(b"\x01" + encoded)
                                except websockets.ConnectionClosed:
                                    return
                    elif msg_type in ("hello", "context"):
                        # Optional: ignore prompts (audio-only protocol).
                        continue
                    else:
                        if not await self._safe_send_json(
                            ws_client, {"type": "error", "message": "Unknown message type."}
                        ):
                            return
            finally:
                forward_task.cancel()
                with contextlib.suppress(
                    asyncio.CancelledError, WebSocketDisconnect, websockets.ConnectionClosed
                ):
                    await forward_task

    @staticmethod
    def _reader_append(reader, payload: bytes):
        # sphn 0.1.x: append_bytes + read_pcm()
        # sphn 0.2.x: append_bytes() -> pcm
        result = reader.append_bytes(payload)
        if hasattr(reader, "read_pcm"):
            return reader.read_pcm()
        return result

    @staticmethod
    def _writer_append(writer, pcm: np.ndarray) -> bytes:
        # sphn 0.1.x: append_pcm() + read_bytes()
        # sphn 0.2.x: append_pcm() -> bytes
        result = writer.append_pcm(pcm)
        if hasattr(writer, "read_bytes"):
            return writer.read_bytes()
        return result
