import math
import os
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple


def _ensure_cuda_available() -> None:
    try:
        import torch
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(
            "PyTorch is not installed. Install requirements.txt and retry."
        ) from exc

    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA GPU not detected. PersonaPlex requires an NVIDIA GPU. "
            "Set PERSONAPLEX_MOCK=1 to run in mock mode."
        )


def _generate_beep(duration_sec: float = 0.6, sample_rate: int = 16000) -> bytes:
    total_samples = int(duration_sec * sample_rate)
    amplitude = 0.15
    freq = 880.0
    pcm = bytearray()
    for n in range(total_samples):
        value = amplitude * math.sin(2 * math.pi * freq * (n / sample_rate))
        int_val = int(max(-1.0, min(1.0, value)) * 32767)
        pcm.extend(int_val.to_bytes(2, byteorder="little", signed=True))
    return bytes(pcm)


@dataclass
class PersonaPlexConfig:
    model_id: str
    mock: bool


class PersonaPlexRunner:
    def __init__(self) -> None:
        self.config = PersonaPlexConfig(
            model_id=os.getenv("PERSONAPLEX_MODEL", "nvidia/personaplex-7b-v1"),
            mock=os.getenv("PERSONAPLEX_MOCK", "1") == "1",
        )
        self._model = None
        self._tokenizer = None
        if not self.config.mock:
            _ensure_cuda_available()
            self._load_model()

    def _load_model(self) -> None:
        """
        Placeholder for PersonaPlex model loading.
        You must install the official NVIDIA PersonaPlex repo or Hugging Face model.
        """
        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer

            self._tokenizer = AutoTokenizer.from_pretrained(self.config.model_id)
            self._model = AutoModelForCausalLM.from_pretrained(
                self.config.model_id, device_map="auto"
            )
        except Exception as exc:
            raise RuntimeError(
                "Failed to load PersonaPlex model. Ensure you have access to "
                f"{self.config.model_id} and have run `huggingface-cli login`."
            ) from exc

    def _mock_text(self, context: Dict[str, str]) -> str:
        topic = context.get("topic") or "a key challenge you've solved"
        role = context.get("role", "candidate")
        level = context.get("level", "")
        return f"As a {level} {role}, tell me about {topic}."

    def generate(
        self, context: Dict[str, str], audio_bytes: Optional[bytes]
    ) -> Tuple[str, bytes, int]:
        """
        Returns (text, pcm_bytes, sample_rate).
        """
        if self.config.mock or self._model is None:
            text = self._mock_text(context)
            audio = _generate_beep()
            return text, audio, 16000

        # TODO: Replace with PersonaPlex audio generation API.
        # For now, generate text only and return a short beep.
        text = self._mock_text(context)
        audio = _generate_beep(duration_sec=0.4)
        time.sleep(0.1)
        return text, audio, 16000
