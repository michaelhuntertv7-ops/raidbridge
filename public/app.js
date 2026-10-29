const $ = id => document.getElementById(id);
let latest, proposalId, serverOffset = 0, busy = false;
async function action(path, data = {}) {
  $('error').hidden = true;
  const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RaidBridge': '1' }, body: JSON.stringify(data), signal: AbortSignal.timeout(5000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function showError(error) { $('error').textContent = error.message; $('error').hidden = false; }
async function run(work) { if (busy) return; busy = true; try { await work(); await refresh(); } catch (error) { showError(error); } finally { busy = false; } }
$('rehearse').onclick = () => run(() => action('rehearse'));
$('skip').onclick = () => run(() => action('skip'));
// Abort must remain available even while another request is in progress.
$('abort').onclick = () => { void action('abort').then(refresh).catch(showError); };
$('disconnect').onclick = () => run(() => action('disconnect'));
$('connect').onclick = () => run(async () => { const { url } = await action('connect'); location.assign(url); });
$('proposal').onsubmit = event => { event.preventDefault(); void run(() => action('approve', { id: proposalId, context: $('context').value, prompt: $('prompt').value })); };
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('overlay-url').value); $('copy').textContent = 'Copied!'; setTimeout(() => $('copy').textContent = 'Copy URL', 1800); } catch { $('overlay-url').select(); showError(new Error('Select and copy the OBS URL manually.')); } };
function render(state) {
  latest = state; serverOffset = state.now - Date.now();
  $('mode').textContent = state.mode === 'rehearsal' ? 'REHEARSAL · SYNTHETIC' : 'LIVE MODE';
  $('mode').classList.toggle('live', state.mode === 'live');
  $('connection').textContent = state.status + (state.user ? ` · @${state.user.login}` : '');
  $('connect').hidden = state.mode !== 'live';
  $('connect').disabled = !state.configured;
  $('connect').textContent = !state.configured ? 'Set Twitch credentials in .env' : state.user ? 'Reconnect Twitch' : 'Connect Twitch';
  $('disconnect').hidden = !state.user;
  $('rehearse').hidden = state.mode !== 'rehearsal';
  $('rehearsal-note').textContent = state.mode === 'rehearsal' ? 'Clearly labeled rehearsal. No Twitch connection required.' : 'Live mode accepts only authenticated Twitch events. No synthetic fallback.';
  $('idle').hidden = Boolean(state.pending || state.card);
  $('proposal').hidden = !state.pending;
  $('running').hidden = !state.card;
  $('skip').disabled = !state.pending && !state.card;
  $('approve').disabled = !state.pending;
  $('stage').textContent = state.pending ? 'AWAITING APPROVAL' : state.card ? state.card.stage.toUpperCase() : 'STANDBY';
  $('deck-title').textContent = state.pending ? 'Your welcome. Your call.' : state.card ? 'The bridge is open.' : 'Ready when they arrive.';
  $('activity').textContent = state.lastAction;
  if (state.pending) {
    const p = state.pending;
    $('raid-name').textContent = p.raid.source;
    $('raid-size').textContent = `${p.raid.viewers} raiders`;
    $('metadata').textContent = `${p.raid.provenance === 'rehearsal' ? 'SYNTHETIC FIXTURE' : 'TWITCH EVENTSUB'} · ${p.metadata.sourceCategory || 'Source category unavailable'} → ${p.metadata.targetCategory || 'Host category unavailable'}`;
    $('warning').hidden = !p.metadata.warning; $('warning').textContent = p.metadata.warning || '';
    if (proposalId !== p.raid.id) { proposalId = p.raid.id; $('context').value = p.context.slice(0, 280); $('prompt').value = p.prompt.slice(0, 280); }
  } else proposalId = undefined;
  if (state.card) { $('running-title').textContent = state.card.title; $('running-body').textContent = state.card.body; }
  if ($('overlay-url').value !== state.overlayUrl) {
    $('overlay-url').value = state.overlayUrl; $('open-overlay').href = state.overlayUrl; $('preview').src = state.overlayUrl;
  }
  timers();
}
function timers() {
  const now = Date.now() + serverOffset;
  if (latest?.pending) $('expires').textContent = `Private proposal expires in ${Math.max(0, Math.ceil((latest.pending.expiresAt - now) / 1000))} seconds.`;
  if (latest?.card) $('remaining').textContent = Math.max(0, Math.ceil((latest.card.sequenceEndsAt - now) / 1000));
}
async function refresh() {
  const response = await fetch('/api/state', { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('Control session unavailable. Reopen the private URL from the terminal.');
  render(await response.json());
}
async function poll() { try { await refresh(); } catch (error) { $('connection').textContent = 'Local server unavailable · overlay clears automatically'; $('approve').disabled = true; $('skip').disabled = true; showError(error); } finally { setTimeout(poll, 500); } }
setInterval(timers, 200); void poll();
