import WebSocket from 'ws';
import { z } from 'zod';

export interface Socket {
  on(event: 'message' | 'close' | 'error', listener: (...args: any[]) => void): unknown;
  close(): void;
  terminate(): void;
}
const welcome = z.object({ id: z.string().min(1), keepalive_timeout_seconds: z.number().int().min(1).max(600) });
export function safeReconnect(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Missing reconnect URL');
  const url = new URL(value);
  if (url.protocol !== 'wss:' || url.hostname !== 'eventsub.wss.twitch.tv' || url.username || url.password || url.port || url.pathname !== '/ws') throw new Error('Untrusted reconnect URL');
  return value;
}
export class EventSub {
  private sockets = new Set<Socket>();
  private current?: Socket;
  private candidate?: Socket;
  private timers = new Map<Socket, ReturnType<typeof setTimeout>>();
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private attempts = 0;
  constructor(private options: {
    subscribe: (id: string) => Promise<void>;
    notify: (raw: unknown) => Promise<void>;
    status: (message: string) => void;
    revoked: () => void;
    socket?: (url: string) => Socket;
    url?: string;
  }) {}
  start() { this.stop(); this.stopped = false; this.attempts = 0; this.connect(this.options.url ?? 'wss://eventsub.wss.twitch.tv/ws'); }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear(); this.current = undefined; this.candidate = undefined;
  }
  private arm(socket: Socket, milliseconds: number) {
    clearTimeout(this.timers.get(socket));
    this.timers.set(socket, setTimeout(() => this.fail(socket, 'EventSub timed out'), milliseconds));
  }
  private forget(socket: Socket) {
    clearTimeout(this.timers.get(socket)); this.timers.delete(socket); this.sockets.delete(socket);
    if (this.current === socket) this.current = undefined;
    if (this.candidate === socket) this.candidate = undefined;
    socket.terminate();
  }
  private fail(socket: Socket, message: string) {
    if (this.stopped || !this.sockets.has(socket)) return;
    this.forget(socket);
    this.options.status(`${message}. Reconnecting; raids during downtime may be missed.`);
    // A failed migration falls back to a fresh session and a new subscription.
    if (this.current) this.forget(this.current);
    if (this.candidate) this.forget(this.candidate);
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(this.options.url ?? 'wss://eventsub.wss.twitch.tv/ws'), Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)));
  }
  private connect(url = 'wss://eventsub.wss.twitch.tv/ws', migrating = false) {
    if (this.stopped) return;
    this.options.status(migrating ? 'Migrating EventSub session…' : 'Connecting to Twitch EventSub…');
    const socket = (this.options.socket ?? (u => new WebSocket(u, { maxPayload: 65536, handshakeTimeout: 10000 })))(url);
    this.sockets.add(socket);
    if (migrating) this.candidate = socket; else this.current = socket;
    this.arm(socket, 10000);
    let ready = false;
    let keepalive = 10000;
    socket.on('message', (data: { toString(): string }) => {
      void (async () => {
        if (!this.sockets.has(socket) || this.stopped) return;
        const message = JSON.parse(data.toString());
        switch (message?.metadata?.message_type) {
          case 'session_welcome': {
            if (ready) throw new Error('Duplicate welcome');
            const session = welcome.parse(message.payload?.session);
            keepalive = session.keepalive_timeout_seconds * 1000;
            ready = true;
            this.arm(socket, keepalive + 1000);
            if (!migrating) await this.options.subscribe(session.id);
            if (!this.sockets.has(socket) || this.stopped) return;
            if (migrating) { if (this.current) this.forget(this.current); this.current = socket; this.candidate = undefined; }
            this.attempts = 0;
            this.options.status('Connected · listening for incoming raids');
            break;
          }
          case 'session_keepalive':
            if (!ready) throw new Error('Keepalive before welcome');
            this.arm(socket, keepalive + 1000); break;
          case 'notification':
            if (!ready) throw new Error('Notification before welcome');
            this.arm(socket, keepalive + 1000);
            await this.options.notify(message); break;
          case 'session_reconnect':
            if (!ready) throw new Error('Reconnect before welcome');
            if (!this.candidate) this.connect(safeReconnect(message.payload?.session?.reconnect_url), true);
            break;
          case 'revocation':
            this.options.status('Twitch subscription revoked. Reconnect your account.');
            this.stop(); this.options.revoked(); break;
          default: throw new Error('Unknown EventSub frame');
        }
      })().catch(() => this.fail(socket, 'EventSub message or subscription failed'));
    });
    socket.on('close', () => this.fail(socket, 'EventSub disconnected'));
    socket.on('error', () => this.fail(socket, 'EventSub connection failed'));
  }
}
