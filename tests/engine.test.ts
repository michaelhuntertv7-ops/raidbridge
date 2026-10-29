import { describe, it, expect, beforeEach } from 'vitest';
import { Engine, parseRaid, syntheticRaid, bridgePrompt } from '../src/engine.js';
describe('raid trust boundary and deterministic sequence', () => {
  let now: number, engine: Engine;
  beforeEach(() => { now = Date.now(); engine = new Engine(() => now); });
  const fill = (e: Engine, time: number, id = 'raid-1') => e.ingest(syntheticRaid(id, time), 'rehearsal', '200');
  const approve = (e: Engine) => e.approve(e.pending!.raid.id, 'Host approved context', 'One emoji!');
  it('parses the exact same envelope with explicit live or rehearsal provenance', () => {
    expect(parseRaid(syntheticRaid('a', now), 'live', '200', now).provenance).toBe('live');
    expect(parseRaid(syntheticRaid('a', now), 'rehearsal', '200', now).viewers).toBe(42);
  });
  it.each(['missing', 'wrong type', 'wrong recipient', 'bad viewers', 'bad timestamp', 'stale', 'future', 'wrong condition', 'blank name', 'wrong version'])('fails closed: %s', which => {
    const raw: any = syntheticRaid('a', now);
    if (which === 'missing') delete raw.payload.event.from_broadcaster_user_id;
    if (which === 'wrong type') raw.metadata.message_type = 'session_keepalive';
    if (which === 'wrong recipient') raw.payload.event.to_broadcaster_user_id = '999';
    if (which === 'bad viewers') raw.payload.event.viewers = -1;
    if (which === 'bad timestamp') raw.metadata.message_timestamp = 'yesterday';
    if (which === 'stale') raw.metadata.message_timestamp = new Date(now - 600001).toISOString();
    if (which === 'future') raw.metadata.message_timestamp = new Date(now + 60001).toISOString();
    if (which === 'wrong condition') raw.payload.subscription.condition.to_broadcaster_user_id = '999';
    if (which === 'blank name') raw.payload.event.from_broadcaster_user_name = ' ';
    if (which === 'wrong version') raw.payload.subscription.version = '2';
    expect(() => engine.ingest(raw, 'live', '200')).toThrow(); expect(engine.card()).toBeNull(); expect(engine.pending).toBeUndefined();
  });
  it('does not expose anything publicly before approval', () => { fill(engine, now); expect(engine.pending).toBeDefined(); expect(engine.card()).toBeNull(); });
  it('requires the current proposal ID and valid edited text', () => {
    fill(engine, now); expect(() => engine.approve('other', 'a', 'b')).toThrow();
    expect(() => engine.approve('raid-1', ' ', 'b')).toThrow();
    expect(() => engine.approve('raid-1', 'a'.repeat(281), 'b')).toThrow(); expect(engine.card()).toBeNull();
  });
  it('runs exactly 90 seconds with approved edits and immutable synthetic labeling', () => {
    fill(engine, now); approve(engine); expect(engine.card()).toMatchObject({ stage: 'arrival', provenance: 'rehearsal' });
    now += 15000; expect(engine.card()).toMatchObject({ stage: 'context', body: 'Host approved context' });
    now += 20000; expect(engine.card()).toMatchObject({ stage: 'bridge', body: 'One emoji!' });
    now += 40000; expect(engine.card()?.stage).toBe('completion');
    now += 14999; expect(engine.card()).not.toBeNull(); now++; expect(engine.card()).toBeNull();
  });
  it('catches up after delayed timers without extending public display', () => { fill(engine, now); approve(engine); now += 95000; expect(engine.card()).toBeNull(); });
  it('expires approvals and prevents stale clicks', () => { fill(engine, now); now += 120000; expect(() => approve(engine)).toThrow(); expect(engine.card()).toBeNull(); });
  it('deduplicates deliveries before and after completion or abort', () => {
    fill(engine, now); expect(fill(engine, now)).toBe('duplicate'); approve(engine); engine.abort(); expect(fill(engine, now)).toBe('duplicate'); expect(engine.pending).toBeUndefined();
  });
  it('drops overlapping raids without replacing the host-approved sequence', () => {
    fill(engine, now); expect(fill(engine, now, 'b')).toBe('busy'); approve(engine); expect(fill(engine, now, 'c')).toBe('busy');
    expect(engine.card()?.title).toContain('PixelPilots'); engine.abort(); expect(fill(engine, now, 'c')).toBe('duplicate');
  });
  it('abort clears active and pending; skip dismisses or advances', () => {
    fill(engine, now); engine.skip(); expect(engine.pending).toBeUndefined(); fill(engine, now, 'b'); engine.abort(); expect(engine.pending).toBeUndefined();
    fill(engine, now, 'c'); approve(engine); engine.skip(); expect(engine.card()?.stage).toBe('context');
    engine.skip(); engine.skip(); engine.skip(); expect(engine.card()).toBeNull();
    fill(engine, now, 'd'); approve(engine); engine.abort(); now += 15000; expect(engine.card()).toBeNull();
  });
  it('uses bounded deterministic context choices and explicit degraded metadata', () => {
    expect(bridgePrompt({ sourceCategory: 'Art', targetCategory: 'Art' })).toContain('Art');
    expect(bridgePrompt({ targetCategory: 'Just Chatting' })).toContain('day');
    engine.ingest(syntheticRaid('a', now), 'live', '200', { warning: 'Metadata unavailable' }); approve(engine);
    expect(engine.card()).toMatchObject({ provenance: 'live', warning: 'Metadata unavailable' });
  });
});
