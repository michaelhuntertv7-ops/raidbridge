# RaidBridge — Codex x TwitchCon Build Brief

Build a new hackathon project created during the Codex x TwitchCon submission window. Use OpenAI Codex as the primary implementation agent and preserve this session for submission evidence.

## Product thesis
RaidBridge turns an incoming Twitch raid into a 90-second shared onboarding ritual instead of a burst of generic welcome messages. It should help the receiving streamer welcome the incoming community, give raiders immediate context, and create a fun bridge between two communities.

## Why this lane
Current hackathon entries are crowded around polls, chat-controlled games, dares, generic overlays, trivia, story voting, and chaos engines. Prior Twitch winners rewarded a specific live-stream moment and strong viewer participation. RaidBridge should own the raid transition itself.

## Core experience
1. Twitch EventSub detects an incoming `channel.raid` event.
2. The system fetches only permitted public Twitch metadata needed for the experience (for example source broadcaster identity, viewer count, category/title when available through authorized Twitch APIs).
3. The receiving streamer gets a private control card with the proposed RaidBridge sequence.
4. Nothing public is shown until the receiving streamer approves it.
5. The OBS browser-source overlay runs a 90-second sequence:
   - Arrival card: who raided + raid size
   - Context card: concise host-approved context about the receiving stream
   - Bridge prompt: one lightweight shared action for both communities, chosen from deterministic templates based on available Twitch context
   - Completion card: welcomes the raiders and closes cleanly
6. If Twitch or metadata calls fail, degrade visibly and safely. Never fabricate live Twitch data.
7. Include a rehearsal/simulation mode that is unmistakably labeled and uses the same state machine as live mode.

## Design goals
- Judge understands value in under 30 seconds.
- Fun to watch at broadcast resolution.
- Streamer can approve, skip, or abort instantly.
- No raw untrusted chat text rendered directly to OBS.
- No paid runtime AI dependency required.
- Minimal setup; prefer chat/EventSub/API + OBS browser source over a Twitch Extension because review time is too long.

## Required technical surfaces
- Node.js + TypeScript preferred.
- Twitch OAuth with least-privilege scopes.
- EventSub WebSocket support for incoming raids.
- Twitch Helix API only where needed.
- Streamer dashboard/control deck.
- OBS browser-source overlay.
- Deterministic state machine for the raid sequence.
- Rehearsal mode feeding synthetic raid events through the exact same parser/state machine and clearly labeling them synthetic.
- Automated tests for event parsing, approval gate, state transitions, abort behavior, duplicate/idempotent raid handling, timeout/reconnect behavior, and simulation labeling.
- README with setup, scopes, threat/trust boundaries, limitations, exact live-vs-rehearsal distinction, and Codex usage notes.

## Trust boundaries inherited from Agent Reliability Lab
- fail closed on malformed events or missing required fields
- explicit provenance of live vs rehearsal inputs
- bounded transitions and timeouts
- idempotent processing of repeated EventSub deliveries
- streamer remains final authority over what appears publicly
- no silent fallback from failed live Twitch calls to synthetic data

## Judging target
Internal release target >=98/100 across:
1. Innovation/Idea
2. Potential Impact
3. Technological Implementation
4. Design

Do not claim the score. Build toward it and surface gaps honestly.

## Deliverables from this Codex session
1. Implement the working v0.1 product in this repository.
2. Run tests and fix failures.
3. Provide a concise architecture note.
4. Provide commands for rehearsal mode and live mode.
5. Provide the exact Twitch app scopes/config needed.
6. Do not invent live validation that has not happened.
7. Keep secrets out of git.
8. Commit implementation locally when complete if git identity is available; otherwise leave a clean working tree ready for commit.

Start by inspecting the empty repository, then implement the smallest polished end-to-end version that can be validated live before the November 2, 2026 2:00 PM PT deadline.
