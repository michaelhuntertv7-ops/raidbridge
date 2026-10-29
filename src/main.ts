import { existsSync } from 'node:fs';
import { createApp } from './server.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535');
if (process.argv.includes('--live') && process.argv.includes('--rehearsal')) throw new Error('Choose live or rehearsal');
const mode = process.argv.includes('--live') ? 'live' : 'rehearsal';
const app = createApp({ port, mode });

app.server.listen(port, '127.0.0.1', () => {
  console.log(`\nRaidBridge v0.1 · ${mode.toUpperCase()}\nPrivate control deck: ${app.origin}/?key=${app.adminKey}\nKeep this control URL private. Copy the OBS URL from the deck.\n`);
});
app.server.on('error', () => {
  console.error('Cannot start RaidBridge. Check whether PORT is already in use.');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => app.server.close());
}
