import { z } from 'zod';

export type Provenance = 'live' | 'rehearsal' | 'twitch-test';
const id = z.string().regex(/^\d{1,30}$/);
const name = z.string().trim().min(1).max(100).refine(s => !/[\x00-\x1f\x7f]/.test(s));
const envelope = z.object({
  metadata: z.object({ message_id: z.string().min(1).max(200), message_type: z.literal('notification'),
    message_timestamp: z.string().datetime({ offset: true }), subscription_type: z.literal('channel.raid'), subscription_version: z.literal('1') }),
  payload: z.object({ subscription: z.object({ type: z.literal('channel.raid'), version: z.literal('1'),
    condition: z.object({ to_broadcaster_user_id: id }) }),
  event: z.object({ from_broadcaster_user_id: id, from_broadcaster_user_login: name, from_broadcaster_user_name: name,
    to_broadcaster_user_id: id, to_broadcaster_user_login: name, to_broadcaster_user_name: name,
    viewers: z.number().int().min(1).max(10000000) }) })
});
export type Raid = { id: string; sourceId: string; source: string; target: string; viewers: number; provenance: Provenance };
export function parseRaid(raw: unknown, provenance: Provenance, targetId: string, now = Date.now()): Raid {
  const v = envelope.parse(raw);
  const age = now - Date.parse(v.metadata.message_timestamp);
  if (age > 600000 || age < -60000) throw new Error('Stale or future event rejected');
  if (v.payload.event.to_broadcaster_user_id !== targetId || v.payload.subscription.condition.to_broadcaster_user_id !== targetId) throw new Error('Wrong receiving channel');
  const e = v.payload.event;
  return { id: v.metadata.message_id, sourceId: e.from_broadcaster_user_id, source: e.from_broadcaster_user_name,
    target: e.to_broadcaster_user_name, viewers: e.viewers, provenance };
}
export function syntheticRaid(messageId: string, now = Date.now()) {
  return { metadata: { message_id: messageId, message_type: 'notification', message_timestamp: new Date(now).toISOString(), subscription_type: 'channel.raid', subscription_version: '1' },
    payload: { subscription: { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: '200' } },
      event: { from_broadcaster_user_id: '100', from_broadcaster_user_login: 'pixelpilots_demo', from_broadcaster_user_name: 'PixelPilots (demo)',
        to_broadcaster_user_id: '200', to_broadcaster_user_login: 'cozyquest_demo', to_broadcaster_user_name: 'CozyQuest (demo)', viewers: 42 } } };
}
export type Context = { sourceCategory?: string; targetCategory?: string; targetTitle?: string; warning?: string };
export function bridgePrompt(context: Context): string {
  if (context.sourceCategory && context.sourceCategory === context.targetCategory) return `Two communities, one love for ${context.targetCategory}. Everyone: share your favorite part in one word!`;
  if (context.targetCategory === 'Just Chatting') return 'One chat, two communities. Everyone: describe your day with one emoji!';
  return 'Raiders and regulars: drop one emoji for the energy you are bringing. Find your emoji twin!';
}
export const stages = ['arrival', 'context', 'bridge', 'completion'] as const;
export type Stage = typeof stages[number];
export const durations = [15000, 20000, 40000, 15000];
export type Proposal = { raid: Raid; context: string; prompt: string; metadata: Context; expiresAt: number };
export type Card = { stage: Stage; title: string; body: string; provenance: Provenance; endsAt: number; sequenceEndsAt: number; warning?: string };
export class Engine {
  pending?: Proposal;
  private active?: { proposal: Proposal; index: number; deadline: number; end: number };
  private seen = new Map<string, number>();
  lastAction = 'Ready for a raid';
  constructor(private now = Date.now) {}
  ingest(raw: unknown, provenance: Provenance, targetId: string, metadata: Context = {}) {
    const raid = parseRaid(raw, provenance, targetId, this.now());
    this.tick();
    for (const [key, time] of this.seen) if (time < this.now() - 660000) this.seen.delete(key);
    const key = `${provenance}:${raid.id}`;
    if (this.seen.has(key)) return 'duplicate';
    if (this.seen.size >= 10000) throw new Error('Event capacity reached');
    this.seen.set(key, this.now());
    if (this.pending || this.active) { this.lastAction = 'Another raid arrived while busy; it was not queued'; return 'busy'; }
    this.pending = { raid, metadata, context: metadata.targetTitle ? `You have landed in ${raid.target}. Today: ${metadata.targetTitle}` : `Welcome to ${raid.target}. Settle in, meet chat, and enjoy the stream.`,
      prompt: bridgePrompt(metadata), expiresAt: this.now() + 120000 };
    this.lastAction = 'Raid awaiting your approval';
    return 'pending';
  }
  approve(id: string, context: string, prompt: string) {
    this.tick();
    if (!this.pending || this.pending.raid.id !== id) throw new Error('Proposal expired or changed');
    const text = z.string().trim().min(1).max(280).refine(s => !/[\x00-\x1f\x7f]/.test(s));
    const approved = { ...this.pending, context: text.parse(context), prompt: text.parse(prompt) };
    const now = this.now();
    this.active = { proposal: approved, index: 0, deadline: now + durations[0]!, end: now + 90000 };
    this.pending = undefined;
    this.lastAction = 'Approved · sequence running';
  }
  skip() {
    this.tick();
    if (this.pending) { this.pending = undefined; this.lastAction = 'Proposal dismissed'; return; }
    if (this.active) {
      const a = this.active;
      a.index++;
      if (a.index >= stages.length) this.active = undefined;
      else { a.deadline = this.now() + durations[a.index]!; a.end = this.now() + durations.slice(a.index).reduce((a,b) => a+b, 0); }
      this.lastAction = 'Stage skipped';
    }
  }
  abort(reason = 'Aborted by streamer') { this.pending = undefined; this.active = undefined; this.lastAction = reason; }
  tick() {
    const now = this.now();
    if (this.pending && now >= this.pending.expiresAt) { this.pending = undefined; this.lastAction = 'Unapproved proposal expired'; }
    while (this.active && now >= this.active.deadline) {
      this.active.index++;
      if (this.active.index >= stages.length) { this.active = undefined; this.lastAction = 'Bridge complete'; }
      else this.active.deadline += durations[this.active.index]!;
    }
  }
  card(): Card | null {
    this.tick();
    if (!this.active) return null;
    const { proposal: p, index, deadline, end } = this.active;
    const titles = [`${p.raid.source} has arrived`, 'Here is where you landed', 'Build a bridge', 'You are part of the party'];
    const bodies = [`${p.raid.viewers.toLocaleString('en-US')} raiders. One warm welcome.`, p.context, p.prompt, `Welcome, ${p.raid.source}. Thanks for bringing your community to ${p.raid.target}!`];
    return { stage: stages[index]!, title: titles[index]!, body: bodies[index]!, provenance: p.raid.provenance,
      endsAt: deadline, sequenceEndsAt: end, warning: p.metadata.warning };
  }
  snapshot() { const card = this.card(); return { pending: this.pending ?? null, card, lastAction: this.lastAction }; }
}
