import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventSub, safeReconnect } from '../src/eventsub.js';
class FakeSocket extends EventEmitter { close() { this.emit('close'); } terminate() { this.emit('close'); } send(type: string, payload = {}) { this.emit('message', JSON.stringify({ metadata: { message_type: type }, payload })); } }
describe('EventSub lifecycle (mocked transport, not live Twitch)', () => {
  let sockets: FakeSocket[], urls: string[], client: EventSub;
  let subscribe: ReturnType<typeof vi.fn>, notify: ReturnType<typeof vi.fn>, status: ReturnType<typeof vi.fn>, revoked: ReturnType<typeof vi.fn>;
  const welcome = (s: FakeSocket) => s.send('session_welcome', { session: { id: 'session-1', keepalive_timeout_seconds: 10 } });
  beforeEach(() => { vi.useFakeTimers(); sockets = []; urls = []; subscribe = vi.fn().mockResolvedValue(undefined); notify = vi.fn().mockResolvedValue(undefined); status = vi.fn(); revoked = vi.fn();
    client = new EventSub({ subscribe, notify, status, revoked, socket: url => { const s = new FakeSocket(); sockets.push(s); urls.push(url); return s; } }); client.start(); });
  afterEach(() => { client.stop(); vi.useRealTimers(); });
  it('subscribes promptly on welcome and accepts notifications', async () => { welcome(sockets[0]!); await vi.advanceTimersByTimeAsync(0); expect(subscribe).toHaveBeenCalledWith('session-1'); sockets[0]!.send('notification'); await vi.advanceTimersByTimeAsync(0); expect(notify).toHaveBeenCalledTimes(1); });
  it('reconnects with backoff on missing welcome', async () => { await vi.advanceTimersByTimeAsync(11000); expect(sockets).toHaveLength(2); expect(status.mock.calls.flat().join()).toContain('timed out'); });
  it('keepalive refreshes timeout; lost keepalive triggers a fresh subscription', async () => {
    welcome(sockets[0]!); await vi.advanceTimersByTimeAsync(9000); sockets[0]!.send('session_keepalive'); await vi.advanceTimersByTimeAsync(9000); expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000); expect(sockets).toHaveLength(2); welcome(sockets[1]!); await vi.advanceTimersByTimeAsync(0); expect(subscribe).toHaveBeenCalledTimes(2);
  });
  it('migrates before closing old session without subscribing again', async () => {
    welcome(sockets[0]!); await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.send('session_reconnect', { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=test' } });
    expect(sockets).toHaveLength(2); welcome(sockets[1]!); await vi.advanceTimersByTimeAsync(0);
    expect(subscribe).toHaveBeenCalledTimes(1); expect(urls[1]).toContain('reconnect=test');
    sockets[0]!.send('notification'); expect(notify).not.toHaveBeenCalled();
  });
  it('falls back to fresh connection if migration never welcomes', async () => { welcome(sockets[0]!); await vi.advanceTimersByTimeAsync(0); sockets[0]!.send('session_reconnect', { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?r=1' } }); await vi.advanceTimersByTimeAsync(11000); expect(urls.at(-1)).toBe('wss://eventsub.wss.twitch.tv/ws'); });
  it('revocation stops retries and calls authority loss handler', async () => { welcome(sockets[0]!); sockets[0]!.send('revocation'); await vi.advanceTimersByTimeAsync(60000); expect(revoked).toHaveBeenCalledOnce(); expect(sockets).toHaveLength(1); });
  it('handles subscription failures without reporting connected', async () => { subscribe.mockRejectedValue(new Error('401')); welcome(sockets[0]!); await vi.advanceTimersByTimeAsync(1000); expect(sockets).toHaveLength(2); expect(status.mock.calls.flat().join()).not.toContain('Connected ·'); });
  it('stops all timers on shutdown', async () => { client.stop(); await vi.advanceTimersByTimeAsync(120000); expect(sockets).toHaveLength(1); });
  it('keeps a caller-supplied official-test endpoint isolated across retries', async () => {
    client.stop(); sockets = []; urls = [];
    client = new EventSub({ subscribe, notify, status, revoked, url: 'ws://127.0.0.1:8080/ws', socket: url => { const s = new FakeSocket(); sockets.push(s); urls.push(url); return s; } });
    client.start(); expect(urls[0]).toBe('ws://127.0.0.1:8080/ws');
    await vi.advanceTimersByTimeAsync(11000); expect(urls[1]).toBe('ws://127.0.0.1:8080/ws');
  });
  it.each(['ws://eventsub.wss.twitch.tv/ws', 'wss://evil.test/ws', 'wss://eventsub.wss.twitch.tv.evil.test/ws', 'wss://user@eventsub.wss.twitch.tv/ws', 'wss://eventsub.wss.twitch.tv/private'])('rejects unsafe reconnect destination %s', url => expect(() => safeReconnect(url)).toThrow());
});
