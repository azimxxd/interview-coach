import os
import subprocess
from typing import Optional

import numpy as np


class LocalTranscriber:
    """
    Lightweight local STT wrapper for Firefox/non-WebSpeech browsers.
    Uses Whisper via Transformers and ffmpeg decode to mono 16k PCM.
    """

    def __init__(self) -> None:
        self.model_id = os.getenv("LOCAL_WHISPER_MODEL", "openai/whisper-tiny.en")
        self._pipeline = None
        self._load_error: Optional[str] = None

    def _load_pipeline(self):
        if self._pipeline is not None:
            return self._pipeline
        if self._load_error is not None:
            raise RuntimeError(self._load_error)

        try:
            import torch
            from transformers import pipeline

            device = "cuda:0" if torch.cuda.is_available() else "cpu"
            self._pipeline = pipeline(
                task="automatic-speech-recognition",
                model=self.model_id,
                device=device,
                chunk_length_s=25,
            )
            return self._pipeline
        except Exception as exc:
            self._load_error = (
                "Failed to initialize local transcriber. "
                f"Model: {self.model_id}. "
                "Ensure dependencies are installed and model is downloadable."
            )
            raise RuntimeError(self._load_error) from exc

    @staticmethod
    def _decode_to_pcm16_mono_16k(audio_bytes: bytes) -> bytes:
        cmd = [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ac",
            "1",
            "-ar",
            "16000",
            "pipe:1",
        ]
        proc = subprocess.run(
            cmd,
            input=audio_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if proc.returncode != 0:
            details = proc.stderr.decode("utf-8", errors="ignore").strip()
            raise RuntimeError(
                "ffmpeg decode failed. Install ffmpeg and provide a supported audio format."
                + (f" Details: {details[:180]}" if details else "")
            )
        return proc.stdout

    def transcribe(self, audio_bytes: bytes, language: Optional[str] = "en") -> str:
        if not audio_bytes:
            return ""

        pipeline = self._load_pipeline()
        pcm = self._decode_to_pcm16_mono_16k(audio_bytes)
        if not pcm:
            return ""

        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        if samples.size == 0:
            return ""

        options = {}
        if language and not str(self.model_id).endswith(".en"):
            options = {"generate_kwargs": {"language": str(language)[:8]}}

        result = pipeline({"raw": samples, "sampling_rate": 16000}, **options)
        if isinstance(result, dict):
            text = result.get("text", "")
            return str(text).strip()
        return ""
