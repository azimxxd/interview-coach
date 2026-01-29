export type VoiceClientMessage =
  | {
      type: "hello";
      sessionId: string;
      lang: "en" | "ru";
      mode: "interviewer";
      role?: string;
      level?: string;
      topic?: string;
    }
  | {
      type: "context";
      role: string;
      level: string;
      topic: string;
      previous?: Array<{ question: string; answer: string }>;
    }
  | {
      type: "audio";
      format: "pcm16";
      sampleRate: number;
      channels: 1;
      data: string;
    }
  | { type: "end_utterance" }
  | { type: "reset" };

export type VoiceServerMessage =
  | { type: "ready" }
  | {
      type: "audio_out";
      format: "pcm16";
      sampleRate: number;
      channels: 1;
      data: string;
    }
  | { type: "text_out"; text: string }
  | { type: "error"; message: string };

type VoiceWsEvents = {
  onMessage: (message: VoiceServerMessage) => void;
  onError: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export class VoiceWsClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly events: VoiceWsEvents;

  constructor(url: string, events: VoiceWsEvents) {
    this.url = url;
    this.events = events;
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.events.onOpen?.();
        resolve();
      };
      this.ws.onerror = () => {
        this.events.onError("WebSocket connection error.");
        reject(new Error("WebSocket connection error."));
      };
      this.ws.onclose = () => {
        this.events.onClose?.();
      };
      this.ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as VoiceServerMessage;
          this.events.onMessage(parsed);
        } catch {
          this.events.onError("Invalid message from voice server.");
        }
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: VoiceClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  isOpen() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }
}
