import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Engine, parseRaid, syntheticRaid } from './engine.js';
import { Twitch } from './twitch.js';
import { EventSub } from './eventsub.js';

export type RaidBridgeMode = 'live' | 'rehearsal' | 'twitch-test';
export type AppOptions = { mode?: RaidBridgeMode; port?: number; twitch?: Twitch; testTargetId?: string; eventSubUrl?: string };

export function createApp(options: AppOptions = {}) {
  const mode = options.mode ?? 'rehearsal';
  const port = options.port ?? 3000;
  const engine = new Engine();
  const adminKey = randomBytes(32).toString('hex');
  const overlayKey = randomBytes(32).toString('hex');
  const origin = `http://localhost:${port}`;
  const twitch = options.twitch ?? new Twitch(
    process.env.TWITCH_CLIENT_ID || '',
    process.env.TWITCH_CLIENT_SECRET || '',
    process.env.TWITCH_REDIRECT_URI || `${origin}/auth/callback`,
  );
  let status = mode === 'rehearsal' ? 'Rehearsal · synthetic events only' : mode === 'twitch-test' ? 'Twitch official test · waiting for CLI WebSocket' : 'Twitch not connected';
  let oauth: { state: string; expiresAt: number } | undefined;

  const eventsub = new EventSub({
    url: options.eventSubUrl,
    subscribe: sessionId => mode === 'twitch-test' ? Promise.resolve() : twitch.subscribe(sessionId),
    notify: async raw => {
      if (mode === 'twitch-test') {
        const targetId = options.testTargetId ?? '200';
        const result = engine.ingest(raw, 'twitch-test', targetId, { warning: 'Official Twitch CLI simulated EventSub event · production metadata not queried' });
        if (result === 'pending') status = 'Twitch official test raid received · awaiting host approval';
        return;
      }
      if (!twitch.user) throw new Error('Twitch identity unavailable');
      const raid = parseRaid(raw, 'live', twitch.user.id);
      const metadata = await twitch.metadata(raid.sourceId);
      const result = engine.ingest(raw, 'live', twitch.user.id, metadata);
      if (result === 'pending') status = 'Raid received · awaiting host approval';
    },
    status: message => { status = mode === 'twitch-test' ? `Twitch official test · ${message}` : message; },
    revoked: () => {
      engine.abort('Twitch subscription revoked');
      if (mode === 'live') twitch.clear();
      status = mode === 'twitch-test' ? 'Twitch official test subscription revoked' : 'Twitch subscription revoked. Reconnect Twitch.';
    },
  });

  const validation = setInterval(() => {
    if (!twitch.user) return;
    void twitch.validate().catch(() => {
      eventsub.stop();
      engine.abort('Twitch authorization lost');
      twitch.clear();
      status = 'Twitch authorization expired or validation failed. Reconnect Twitch.';
    });
  }, 3_600_000);
  validation.unref();

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (code: number, value: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      const expectedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
      if (!req.headers.host || !expectedHosts.has(req.headers.host)) return send(403, { error: 'Untrusted host' });
      const url = new URL(req.url || '/', origin);
      const cookieName = 'rb_admin';
      const cookie = req.headers.cookie?.split(';').some(c => c.trim() === `${cookieName}=${adminKey}`) ?? false;
      const isAdmin = cookie || req.headers.authorization === `Bearer ${adminKey}`;

      if (req.method === 'GET' && url.pathname === '/' && url.searchParams.get('key') === adminKey) {
        res.writeHead(303, { 'Set-Cookie': `${cookieName}=${adminKey}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' });
        return res.end();
      }

      if (req.method === 'GET' && ['/app.js', '/style.css', '/overlay.js'].includes(url.pathname)) {
        const contentType = url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
        res.setHeader('Content-Type', contentType);
        return res.end(await readFile(new URL(`../public${url.pathname}`, import.meta.url)));
      }

      const overlayAuth = url.searchParams.get('key') === overlayKey || req.headers['x-overlay-key'] === overlayKey;
      if (req.method === 'GET' && url.pathname === '/overlay') {
        if (!overlayAuth) return send(403, { error: 'Invalid overlay key' });
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(await readFile(new URL('../public/overlay.html', import.meta.url)));
      }
      if (req.method === 'GET' && url.pathname === '/api/overlay') {
        if (!overlayAuth) return send(403, { error: 'Invalid overlay key' });
        return send(200, { card: engine.card(), now: Date.now() });
      }

      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        if (mode !== 'live' || !oauth || oauth.expiresAt < Date.now() || url.searchParams.get('state') !== oauth.state) {
          return send(403, { error: 'Invalid or expired OAuth state' });
        }
        oauth = undefined;
        const code = url.searchParams.get('code');
        if (!code) return send(400, { error: 'Twitch authorization declined' });
        eventsub.stop();
        engine.abort('Twitch reconnect started');
        twitch.clear();
        try {
          await twitch.authorize(code);
          eventsub.start();
          status = `Connected as @${twitch.user?.login ?? 'Twitch user'}`;
        } catch {
          status = 'Twitch authorization failed. Try connecting again.';
          return send(400, { error: status });
        }
        res.writeHead(303, {
          'Set-Cookie': `${cookieName}=${adminKey}; HttpOnly; SameSite=Strict; Path=/`,
          Location: '/',
        });
        return res.end();
      }

      if (!isAdmin) return send(401, { error: 'Open the private dashboard URL printed in the terminal.' });

      if (req.method === 'GET' && url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const snapshot = engine.snapshot();
        return send(200, {
          mode,
          status,
          configured: twitch.configured,
          user: twitch.user ?? null,
          pending: snapshot.pending,
          card: snapshot.card,
          lastAction: snapshot.lastAction,
          overlayUrl: `${origin}/overlay?key=${overlayKey}`,
          now: Date.now(),
        });
      }

      if (req.method !== 'POST') return send(404, { error: 'Not found' });
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') {
        return send(403, { error: 'Same-origin JSON request required' });
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) return send(413, { error: 'Request too large' });
      }
      const data = JSON.parse(body || '{}');
      switch (url.pathname) {
        case '/api/rehearse': {
          if (mode !== 'rehearsal') return send(400, { error: 'Synthetic inputs disabled outside rehearsal mode' });
          const id = `rehearsal-${Date.now()}-${randomBytes(4).toString('hex')}`;
          engine.ingest(syntheticRaid(id), 'rehearsal', '200');
          break;
        }
        case '/api/approve':
          engine.approve(String(data.id ?? ''), String(data.context ?? ''), String(data.prompt ?? ''));
          if (mode === 'twitch-test') status = 'Twitch official test · host-approved sequence running';
          else if (mode === 'live') status = 'Live raid · host-approved sequence running';
          break;
        case '/api/skip': engine.skip(); break;
        case '/api/abort':
          engine.abort();
          if (mode === 'twitch-test') status = 'Twitch official test · overlay cleared';
          else if (mode === 'live') status = 'Live mode · overlay cleared';
          break;
        case '/api/connect': {
          if (mode !== 'live' || !twitch.configured || twitch.redirect !== `${origin}/auth/callback`) {
            return send(400, { error: 'Configure Twitch client ID, secret and exact localhost redirect first.' });
          }
          oauth = { state: randomBytes(32).toString('hex'), expiresAt: Date.now() + 300_000 };
          const params = new URLSearchParams({
            client_id: twitch.clientId,
            redirect_uri: twitch.redirect,
            response_type: 'code',
            scope: '',
            state: oauth.state,
            force_verify: 'true',
          });
          return send(200, { url: `https://id.twitch.tv/oauth2/authorize?${params}` });
        }
        case '/api/disconnect':
          eventsub.stop();
          twitch.clear();
          engine.abort('Twitch disconnected by host');
          status = 'Twitch disconnected by host';
          break;
        default: return send(404, { error: 'Not found' });
      }
      return send(200, { ok: true });
    } catch (error) {
      return send(400, { error: error instanceof Error ? error.message : 'Request failed' });
    }
  });

  server.on('close', () => {
    clearInterval(validation);
    eventsub.stop();
    twitch.clear();
  });

  return { server, engine, twitch, eventsub, adminKey, overlayKey, origin, mode };
}
