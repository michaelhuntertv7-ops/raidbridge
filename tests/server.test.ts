import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

const running: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) {
    if (app.server.listening) await new Promise<void>(resolve => app.server.close(() => resolve()));
  }
});

async function start(port: number, mode: 'live' | 'rehearsal' = 'rehearsal') {
  const app = createApp({ port, mode });
  running.push(app);
  await new Promise<void>(resolve => app.server.listen(port, '127.0.0.1', resolve));
  return app;
}

describe('HTTP trust boundary', () => {
  it('keeps proposal private until approval and protects control/overlay surfaces', async () => {
    const app = await start(31987);
    const cookie = `rb_admin=${app.adminKey}`;
    const get = (path: string, headers: Record<string, string> = {}) => fetch(app.origin + path, { headers });
    const post = (path: string, body: unknown = {}, requestOrigin = app.origin) => fetch(app.origin + path, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect((await get('/')).status).toBe(401);
    const unlock = await fetch(`${app.origin}/?key=${app.adminKey}`, { redirect: 'manual' });
    expect(unlock.status).toBe(303);
    expect(unlock.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await get('/api/state')).status).toBe(401);
    expect((await get('/api/overlay')).status).toBe(403);
    expect((await post('/api/rehearse', {}, 'https://evil.example')).status).toBe(403);

    expect((await post('/api/rehearse')).status).toBe(200);
    const state = await (await get('/api/state', { Cookie: cookie })).json() as any;
    expect(state.pending.raid.provenance).toBe('rehearsal');
    const overlay = async () => (await get('/api/overlay', { 'X-Overlay-Key': app.overlayKey })).json() as Promise<any>;
    expect((await overlay()).card).toBeNull();

    expect((await post('/api/approve', { id: state.pending.raid.id, context: 'Welcome to our stream', prompt: 'Wave hello' })).status).toBe(200);
    const shown = await overlay();
    expect(shown.card.provenance).toBe('rehearsal');
    expect(shown.card.body).toContain('raiders');

    await post('/api/abort');
    expect((await overlay()).card).toBeNull();
    expect((await fetch(`${app.origin}/auth/callback?state=bad&code=bad`)).status).toBe(403);
    expect((await fetch('http://127.0.0.1:31987/api/state')).status).toBe(401);
  });

  it('refuses synthetic injection in live mode', async () => {
    const app = await start(31988, 'live');
    const response = await fetch(app.origin + '/api/rehearse', {
      method: 'POST',
      headers: { Cookie: `rb_admin=${app.adminKey}`, Origin: app.origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    expect(app.engine.card()).toBeNull();
    expect(app.engine.pending).toBeUndefined();
  });
});
