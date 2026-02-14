export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error";

export type WebSocketLike = {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
};

type ConnectionManagerOptions<TSend, TReceive> = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  heartbeatIntervalMs?: number;
  deadConnectionMs?: number;
  maxQueueSize?: number;
  serialize?: (message: TSend) => string;
  parse?: (raw: string) => TReceive | null;
  createSocket?: (url: string) => WebSocketLike;
  createHeartbeatMessage?: () => TSend | null;
  onStateChange?: (state: ConnectionState) => void;
  onMessage?: (message: TReceive) => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
};

export type BackoffOptions = {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  random: () => number;
};

export function calculateBackoffDelay(attempt: number, options: BackoffOptions) {
  const exponent = Math.max(0, attempt - 1);
  const raw = options.baseDelayMs * 2 ** exponent;
  const capped = Math.min(raw, options.maxDelayMs);
  const jitterOffset = capped * options.jitterRatio * (options.random() * 2 - 1);
  return Math.max(250, Math.round(capped + jitterOffset));
}

const SOCKET_OPEN = 1;

export class ConnectionManager<TSend, TReceive> {
  private readonly url: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterRatio: number;
  private readonly heartbeatIntervalMs: number;
  private readonly deadConnectionMs: number;
  private readonly maxQueueSize: number;
  private readonly serialize: (message: TSend) => string;
  private readonly parse: (raw: string) => TReceive | null;
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly createHeartbeatMessage?: () => TSend | null;
  private readonly onStateChange?: (state: ConnectionState) => void;
  private readonly onMessage?: (message: TReceive) => void;
  private readonly onError?: (message: string) => void;
  private readonly onOpen?: () => void;

  private socket: WebSocketLike | null = null;
  private state: ConnectionState = "connecting";
  private attempt = 0;
  private queue: TSend[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private manuallyStopped = false;
  private online = true;
  private lastMessageAt = 0;

  constructor(url: string, options: ConnectionManagerOptions<TSend, TReceive> = {}) {
    this.url = url;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.baseDelayMs = options.baseDelayMs ?? 600;
    this.maxDelayMs = options.maxDelayMs ?? 10000;
    this.jitterRatio = options.jitterRatio ?? 0.25;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.deadConnectionMs = options.deadConnectionMs ?? 30000;
    this.maxQueueSize = options.maxQueueSize ?? 300;
    this.serialize = options.serialize ?? ((value) => JSON.stringify(value));
    this.parse = options.parse ?? ((raw) => JSON.parse(raw) as TReceive);
    this.createSocket = options.createSocket ?? ((value) => new WebSocket(value));
    this.createHeartbeatMessage = options.createHeartbeatMessage;
    this.onStateChange = options.onStateChange;
    this.onMessage = options.onMessage;
    this.onError = options.onError;
    this.onOpen = options.onOpen;
  }

  start() {
    this.manuallyStopped = false;
    if (!this.online) {
      this.transition("offline");
      return;
    }
    if (this.socket && this.socket.readyState === SOCKET_OPEN) {
      this.transition("connected");
      return;
    }
    this.openSocket(false);
  }

  stop() {
    this.manuallyStopped = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.safeCloseSocket();
    this.transition(this.online ? "error" : "offline");
  }

  retryNow() {
    if (!this.online) {
      this.transition("offline");
      return;
    }
    this.clearReconnectTimer();
    this.safeCloseSocket();
    this.openSocket(true);
  }

  setOnlineStatus(online: boolean) {
    this.online = online;
    if (!online) {
      this.clearReconnectTimer();
      this.clearHeartbeatTimer();
      this.safeCloseSocket();
      this.transition("offline");
      return;
    }

    if (this.state === "offline" || this.state === "error") {
      this.retryNow();
    }
  }

  send(message: TSend) {
    if (this.socket && this.socket.readyState === SOCKET_OPEN) {
      this.sendNow(message);
      return;
    }

    this.queue.push(message);
    if (this.queue.length > this.maxQueueSize) {
      this.queue.splice(0, this.queue.length - this.maxQueueSize);
    }
  }

  getState() {
    return this.state;
  }

  getQueueSize() {
    return this.queue.length;
  }

  private transition(state: ConnectionState) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }

  private safeCloseSocket() {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // ignore close errors
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startHeartbeat() {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;

      const ageMs = Date.now() - this.lastMessageAt;
      if (ageMs > this.deadConnectionMs) {
        this.safeCloseSocket();
        this.scheduleReconnect("Connection timed out.");
        return;
      }

      if (this.createHeartbeatMessage) {
        const heartbeat = this.createHeartbeatMessage();
        if (heartbeat) {
          this.sendNow(heartbeat);
        }
      }
    }, this.heartbeatIntervalMs);
  }

  private sendNow(message: TSend) {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;
    try {
      this.socket.send(this.serialize(message));
    } catch {
      this.queue.push(message);
      this.scheduleReconnect("Send failed. Reconnecting...");
    }
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) continue;
      this.sendNow(next);
    }
  }

  private openSocket(reconnecting: boolean) {
    if (!this.online) {
      this.transition("offline");
      return;
    }

    this.clearReconnectTimer();
    this.safeCloseSocket();
    this.transition(reconnecting ? "reconnecting" : "connecting");

    try {
      const socket = this.createSocket(this.url);
      this.socket = socket;

      socket.onopen = () => {
        this.attempt = 0;
        this.lastMessageAt = Date.now();
        this.transition("connected");
        this.startHeartbeat();
        this.onOpen?.();
        this.flushQueue();
      };

      socket.onmessage = (event) => {
        this.lastMessageAt = Date.now();
        const text = typeof event.data === "string" ? event.data : "";
        if (!text) return;
        try {
          const parsed = this.parse(text);
          if (!parsed) return;
          this.onMessage?.(parsed);
        } catch {
          this.onError?.("Invalid message from voice server.");
        }
      };

      socket.onerror = () => {
        this.onError?.("WebSocket connection error.");
      };

      socket.onclose = () => {
        this.clearHeartbeatTimer();
        this.socket = null;
        if (this.manuallyStopped) return;
        this.scheduleReconnect("Connection closed.");
      };
    } catch {
      this.scheduleReconnect("Unable to open WebSocket.");
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.manuallyStopped) return;
    if (!this.online) {
      this.transition("offline");
      return;
    }

    this.attempt += 1;
    if (this.attempt > this.maxAttempts) {
      this.transition("error");
      this.onError?.(`${reason} Max retries reached.`);
      return;
    }

    this.transition("reconnecting");
    const delay = calculateBackoffDelay(this.attempt, {
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
      jitterRatio: this.jitterRatio,
      random: Math.random
    });

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.openSocket(true);
    }, delay);
  }
}
