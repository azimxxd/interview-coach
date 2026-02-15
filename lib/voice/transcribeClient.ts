type TranscribeResponse = {
  error?: unknown;
  transcript?: unknown;
};

type TranscribeOptions = {
  voiceWsUrl?: string;
};

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("wav") || mimeType.includes("wave")) {
    return "wav";
  }
  if (mimeType.includes("mp4") || mimeType.includes("mpeg")) {
    return "m4a";
  }
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

export type TranscriptionResult = {
  transcript: string;
  error: string | null;
};

export async function transcribeAudioBlob(
  blob: Blob,
  language = "en",
  options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
  if (!blob || blob.size <= 0) {
    return {
      transcript: "",
      error: "Recorded audio is empty."
    };
  }

  try {
    const mimeType = blob.type || "audio/webm";
    const filename = `answer.${extensionFromMimeType(mimeType)}`;
    const file = new File([blob], filename, { type: mimeType });
    const form = new FormData();
    form.append("audio", file);
    form.append("language", language);
    if (options.voiceWsUrl?.trim()) {
      form.append("voice_ws_url", options.voiceWsUrl.trim());
    }

    const response = await fetch("/api/interview/transcribe", {
      method: "POST",
      body: form
    });

    if (!response.ok) {
      let message = "Server transcription failed.";
      try {
        const errorPayload = (await response.json()) as TranscribeResponse;
        if (typeof errorPayload.error === "string" && errorPayload.error.trim()) {
          message = errorPayload.error.trim();
        }
      } catch {
        // Ignore parse errors and keep fallback message.
      }
      return {
        transcript: "",
        error: message
      };
    }

    const payload = (await response.json()) as TranscribeResponse;
    return {
      transcript: typeof payload.transcript === "string" ? payload.transcript.trim() : "",
      error: null
    };
  } catch {
    return {
      transcript: "",
      error: "Unable to reach transcription service."
    };
  }
}
