import { z } from 'zod';
import type { Context } from './engine.js';
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive() });
const validationSchema = z.object({ client_id: z.string(), user_id: z.string().regex(/^\d+$/), login: z.string().min(1), expires_in: z.number() });
export class Twitch {
  private token?: z.infer<typeof tokenSchema>;
  private expires = 0;
  private refreshing?: Promise<void>;
  user?: { id: string; login: string };
  constructor(readonly clientId: string, private secret: string, readonly redirect: string, private request: typeof fetch = fetch) {}
  get configured() { return Boolean(this.clientId && this.secret); }
  private async json(url: string, init: RequestInit = {}) {
    const response = await this.request(url, { ...init, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error(`Twitch request failed (${response.status})`);
    return response.json();
  }
  private async exchange(params: Record<string, string>) {
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, ...params });
    this.token = tokenSchema.parse(await this.json('https://id.twitch.tv/oauth2/token', { method: 'POST', body }));
    this.expires = Date.now() + this.token.expires_in * 1000;
  }
  async authorize(code: string) {
    try { await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: this.redirect }); await this.validate(); }
    catch (error) { this.clear(); throw error; }
  }
  private async access() {
    if (!this.token) throw new Error('Connect Twitch first');
    if (this.expires < Date.now() + 60000) {
      this.refreshing ??= this.exchange({ grant_type: 'refresh_token', refresh_token: this.token.refresh_token }).finally(() => { this.refreshing = undefined; });
      await this.refreshing;
    }
    return this.token!.access_token;
  }
  async validate() {
    const access = await this.access();
    const v = validationSchema.parse(await this.json('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${access}` } }));
    if (v.client_id !== this.clientId || (this.user && v.user_id !== this.user.id)) throw new Error('Token identity mismatch');
    this.user = { id: v.user_id, login: v.login };
  }
  async helix(path: string, init: RequestInit = {}) {
    const access = await this.access();
    return this.json(`https://api.twitch.tv/helix/${path}`, { ...init, headers: { Authorization: `Bearer ${access}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' } });
  }
  async subscribe(session: string) {
    if (!this.user) throw new Error('No authenticated user');
    await this.helix('eventsub/subscriptions', { method: 'POST', body: JSON.stringify({ type: 'channel.raid', version: '1',
      condition: { to_broadcaster_user_id: this.user.id }, transport: { method: 'websocket', session_id: session } }) });
  }
  async metadata(sourceId: string): Promise<Context> {
    if (!this.user) return { warning: 'Twitch metadata unavailable' };
    try {
      const channels = z.object({ data: z.array(z.object({ broadcaster_id: z.string(), game_name: z.string().max(150), title: z.string().max(300) })) })
        .parse(await this.helix(`channels?broadcaster_id=${encodeURIComponent(sourceId)}&broadcaster_id=${this.user.id}`)).data;
      const source = channels.find(c => c.broadcaster_id === sourceId);
      const target = channels.find(c => c.broadcaster_id === this.user!.id);
      return { sourceCategory: source?.game_name || undefined, targetCategory: target?.game_name || undefined,
        targetTitle: target?.title || undefined, warning: !source || !target ? 'Some Twitch metadata unavailable' : undefined };
    } catch { return { warning: 'Twitch metadata unavailable · using a generic welcome' }; }
  }
  clear() { this.token = undefined; this.user = undefined; this.expires = 0; }
}
