const $ = id => document.getElementById(id);
const key = new URLSearchParams(location.search).get('key') || '';
let card = null, offset = 0, lastSuccess = 0, currentSignature = '';
const durations = { arrival: 15000, context: 20000, bridge: 40000, completion: 15000 };
function hide() { $('card').hidden = true; }
function render(next, serverNow) {
  card = next; offset = serverNow - Date.now(); lastSuccess = Date.now();
  if (!card) { hide(); currentSignature = ''; return; }
  $('provenance').textContent = card.provenance === 'rehearsal' ? 'REHEARSAL · SYNTHETIC DATA' : card.provenance === 'twitch-test' ? 'TWITCH OFFICIAL TEST · SIMULATED EVENT · HOST APPROVED' : 'LIVE RAID · HOST APPROVED';
  $('provenance').classList.toggle('live', card.provenance === 'live');
  $('step').textContent = ({ arrival: '01 / A NEW PARTY HAS ARRIVED', context: '02 / GET YOUR BEARINGS', bridge: '03 / YOUR FIRST SHARED MOMENT', completion: '04 / THE BRIDGE IS BUILT' })[card.stage];
  $('title').textContent = card.title; $('body').textContent = card.body;
  $('degraded').hidden = !card.warning; $('degraded').textContent = card.warning || '';
  const signature = card.stage + card.endsAt;
  if (signature !== currentSignature) { $('card').classList.remove('enter'); void $('card').offsetWidth; $('card').classList.add('enter'); currentSignature = signature; }
  update();
}
function update() {
  if (!card || Date.now() - lastSuccess > 2000 || Date.now() + offset >= card.endsAt) { hide(); return; }
  $('card').hidden = false;
  const remaining = Math.max(0, card.endsAt - Date.now() - offset);
  $('clock').textContent = `${Math.ceil(remaining / 1000)}s`;
  $('progress').style.width = `${Math.min(100, remaining / durations[card.stage] * 100)}%`;
}
async function poll() {
  try {
    const response = await fetch(`/api/overlay?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) { card = null; hide(); return; }
    const state = await response.json(); render(state.card, state.now);
  } catch { hide(); } finally { setTimeout(poll, 250); }
}
setInterval(update, 100); void poll();
