import { describe, expect, it } from 'vitest';
import { Twitch } from '../src/twitch.js';

describe('Twitch OAuth and Helix boundary', () => {
  it('exchanges, validates, refreshes, subscribes and clears without exposing tokens', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let tokenCount = 0;
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/token')) {
        tokenCount++;
        return Response.json({ access_token: `access-${tokenCount}`, refresh_token: `refresh-${tokenCount}`, expires_in: tokenCount === 1 ? 1 : 3600 });
      }
      if (url.endsWith('/validate')) return Response.json({ client_id: 'client', user_id: '123', login: 'host', expires_in: 3600 });
      if (url.includes('/eventsub/subscriptions')) return Response.json({ data: [] });
      if (url.includes('/channels?')) return Response.json({ data: [
        { broadcaster_id: '456', game_name: 'Art', title: 'Source title' },
        { broadcaster_id: '123', game_name: 'Art', title: 'Host title' },
      ] });
      return new Response('', { status: 404 });
    };
    const twitch = new Twitch('client', 'secret', 'http://localhost:3000/auth/callback', request as typeof fetch);
    await twitch.authorize('code');
    expect(twitch.user).toEqual({ id: '123', login: 'host' });
    expect(twitch.configured).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1100));
    await twitch.subscribe('session-1');
    expect(tokenCount).toBeGreaterThanOrEqual(2);
    const subscriptionCall = calls.find(c => c.url.includes('/eventsub/subscriptions'));
    expect(subscriptionCall?.init?.method).toBe('POST');
    expect(String(subscriptionCall?.init?.body)).toContain('channel.raid');
    const metadata = await twitch.metadata('456');
    expect(metadata).toMatchObject({ sourceCategory: 'Art', targetCategory: 'Art', targetTitle: 'Host title' });
    twitch.clear();
    expect(twitch.user).toBeUndefined();
  });

  it('fails closed on token client mismatch', async () => {
    const request = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/token')) return Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      if (url.endsWith('/validate')) return Response.json({ client_id: 'other', user_id: '123', login: 'host', expires_in: 3600 });
      return new Response('', { status: 404 });
    };
    const twitch = new Twitch('client', 'secret', 'http://localhost:3000/auth/callback', request as typeof fetch);
    await expect(twitch.authorize('code')).rejects.toThrow('Token identity mismatch');
    expect(twitch.user).toBeUndefined();
  });

  it('degrades metadata explicitly instead of inventing facts', async () => {
    const request = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/token')) return Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      if (url.endsWith('/validate')) return Response.json({ client_id: 'client', user_id: '123', login: 'host', expires_in: 3600 });
      return new Response('', { status: 503 });
    };
    const twitch = new Twitch('client', 'secret', 'http://localhost:3000/auth/callback', request as typeof fetch);
    await twitch.authorize('code');
    await expect(twitch.metadata('456')).resolves.toMatchObject({ warning: expect.stringContaining('unavailable') });
  });
});
