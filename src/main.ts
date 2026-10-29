import { existsSync } from 'node:fs';
import { createApp, type RaidBridgeMode } from './server.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535');
const flags = ['--live', '--rehearsal', '--twitch-test'].filter(flag => process.argv.includes(flag));
if (flags.length > 1) throw new Error('Choose exactly one mode');
const mode: RaidBridgeMode = process.argv.includes('--live') ? 'live' : process.argv.includes('--twitch-test') ? 'twitch-test' : 'rehearsal';
const app = createApp({
  port,
  mode,
  testTargetId: process.env.TWITCH_TEST_TARGET_ID ?? '200',
  eventSubUrl: mode === 'twitch-test' ? (process.env.TWITCH_TEST_WS_URL ?? 'ws://127.0.0.1:8080/ws') : undefined,
});

app.server.listen(port, '127.0.0.1', () => {
  if (mode === 'twitch-test') app.eventsub.start();
  console.log(`\nRaidBridge v0.1 · ${mode.toUpperCase()}\nPrivate control deck: ${app.origin}/?key=${app.adminKey}\nKeep this control URL private. Copy the OBS URL from the deck.\n`);
});
app.server.on('error', () => {
  console.error('Cannot start RaidBridge. Check whether PORT is already in use.');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => app.server.close());
}
