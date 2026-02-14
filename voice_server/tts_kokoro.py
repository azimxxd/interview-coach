import io
import os
import wave
from typing import Dict, Optional

import numpy as np


def _float32_to_pcm16(arr: np.ndarray) -> np.ndarray:
    clipped = np.clip(arr, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16)


def _pcm16_wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    pcm16 = _float32_to_pcm16(samples)
    with io.BytesIO() as buffer:
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(pcm16.tobytes())
        return buffer.getvalue()


def _extract_audio_chunk(item) -> np.ndarray:
    if item is None:
        return np.zeros(0, dtype=np.float32)

    audio = None
    if hasattr(item, "audio"):
        audio = getattr(item, "audio")
    elif isinstance(item, (tuple, list)) and len(item) >= 3:
        audio = item[2]

    if audio is None:
        return np.zeros(0, dtype=np.float32)

    # Kokoro may return torch tensors depending on runtime.
    try:
        import torch  # type: ignore

        if isinstance(audio, torch.Tensor):
            audio = audio.detach().float().cpu().numpy()
    except Exception:
        # Torch may not be importable in lightweight environments.
        pass

    arr = np.asarray(audio, dtype=np.float32).reshape(-1)
    if arr.size == 0:
        return np.zeros(0, dtype=np.float32)
    return arr


class LocalKokoroTts:
    """
    Optional local Kokoro TTS engine for clearer repeat playback.
    Lazy-loads model on first use to keep startup fast.
    """

    def __init__(self) -> None:
        self.enabled = os.getenv("LOCAL_TTS_PROVIDER", "kokoro").lower() == "kokoro"
        self.default_voice = os.getenv("KOKORO_VOICE", "af_heart")
        self.default_speed = float(os.getenv("KOKORO_SPEED", "0.95"))
        self.default_lang_code = os.getenv("KOKORO_LANG_CODE", "a")
        self._pipelines: Dict[str, object] = {}
        self._load_error: Optional[str] = None

    def _load_pipeline(self, lang_code: str):
        if lang_code in self._pipelines:
            return self._pipelines[lang_code]
        if self._load_error is not None:
            raise RuntimeError(self._load_error)

        try:
            from kokoro import KPipeline
        except Exception as exc:
            self._load_error = (
                "Kokoro is not installed. Install `kokoro>=0.9.2` in voice_server."
            )
            raise RuntimeError(self._load_error) from exc

        try:
            pipeline = KPipeline(lang_code=lang_code)
            self._pipelines[lang_code] = pipeline
            return pipeline
        except Exception as exc:
            self._load_error = (
                f"Failed to initialize Kokoro pipeline (lang_code={lang_code}). "
                "Ensure model download is available and espeak-ng is installed."
            )
            raise RuntimeError(self._load_error) from exc

    def synthesize(
        self,
        text: str,
        *,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        lang_code: Optional[str] = None,
    ) -> tuple[bytes, int]:
        if not self.enabled:
            raise RuntimeError("Local TTS provider is disabled.")

        normalized_text = text.strip()
        if not normalized_text:
            return b"", 24000

        use_voice = (voice or self.default_voice).strip() or self.default_voice
        use_speed = speed if speed is not None else self.default_speed
        use_speed = max(0.7, min(1.3, float(use_speed)))
        use_lang_code = (lang_code or self.default_lang_code).strip() or self.default_lang_code

        pipeline = self._load_pipeline(use_lang_code)
        generator = pipeline(
            normalized_text,
            voice=use_voice,
            speed=use_speed,
            split_pattern=r"\n+",
        )

        chunks = []
        for item in generator:
            arr = _extract_audio_chunk(item)
            if arr.size:
                chunks.append(arr)

        if not chunks:
            return b"", 24000

        samples = np.concatenate(chunks).astype(np.float32)
        wav = _pcm16_wav_bytes(samples, 24000)
        return wav, 24000
