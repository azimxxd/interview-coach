type TranscribeResponse = {
  error?: unknown;
  transcript?: unknown;
};

function extensionFromMimeType(mimeType: string) {
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
  language = "en"
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
