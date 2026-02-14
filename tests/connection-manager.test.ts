import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectionManager,
  calculateBackoffDelay,
  type WebSocketLike
} from "../lib/voice/connectionManager";

type TestMessage = { type: "hello" | "context"; value?: string };

class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: string[] = [];

  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }

  emitMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

test("backoff delay uses cap and jitter", () => {
  const delay = calculateBackoffDelay(4, {
    baseDelayMs: 500,
    maxDelayMs: 3000,
    jitterRatio: 0.2,
    random: () => 0.5
  });

  assert.equal(delay, 3000);
});

test("connection manager transitions and flushes queued messages", async () => {
  const sockets: FakeSocket[] = [];
  const states: string[] = [];

  const manager = new ConnectionManager<TestMessage, { ok: boolean }>("ws://test", {
    baseDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
    heartbeatIntervalMs: 100000,
    deadConnectionMs: 200000,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onStateChange: (state) => states.push(state),
    parse: (raw) => JSON.parse(raw) as { ok: boolean }
  });

  manager.send({ type: "context", value: "queued" });
  assert.equal(manager.getQueueSize(), 1);

  manager.start();
  assert.equal(sockets.length, 1);
  sockets[0].open();

  assert.equal(states.includes("connected"), true);
  assert.equal(manager.getQueueSize(), 0);
  assert.equal(sockets[0].sent.length, 1);

  sockets[0].close();

  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(sockets.length >= 2, true);

  manager.stop();
});
