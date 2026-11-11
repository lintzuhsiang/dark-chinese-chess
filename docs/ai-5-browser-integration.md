# AI-5 — Playable browser opponent

AI-4 was committed as `9073bc0`. The owner authorized AI-5 implementation and an
AI-6 improvement-options review. The owner subsequently approved committing AI-5,
AI-5.1, and SAFETY-TIE-1. Core/rules stay
pinned to `b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75`; no new dependency or backend.

## Play

From the repository root, run `pnpm dev` and open its localhost URL. Choose your
seat and AI strategy, then **開始人機對弈**. Expected Value is the default; Heuristic
and Random remain available under their algorithm names, without difficulty claims.
The separately approved SAFETY-TIE-1 experiment is selectable as **期望值＋安全決勝**;
it changes only all-MOVE exact top ties with an immediate losing capture reply and
a safe tied alternative. Legacy Expected Value remains the default. See the
[policy boundary and diagnostics](../packages/ai-agents/README.md#safety-tie-1-experiment).

- P1 always opens. The first FLIP assigns P1 its revealed color, including when
  P1 is the AI. The human may choose either seat.
- Human input is blocked on the AI turn. Status identifies you/AI and shows thinking,
  paused failures, or the stored terminal result. Selection/history/captures retain
  the existing UI behavior, with no tactical hints.
- The subsequently authorized AI-5.1 pacing improvement lets the human action
  receive a visible paint opportunity before a variable minimum dwell: FLIP
  500–900 ms, quiet MOVE 350–700 ms, CAPTURE 450–850 ms. Worker computation begins
  immediately; slow results add no full extra wait. Hidden time does not count;
  restart/mode/revision/unmount cancel pending presentation as well as computation.
  See the [AI-5.1 investigation](ai-5-1-gameplay-investigation.md).
- Undo is disabled and rejected only in AI mode. Local two-player Undo is preserved.
- Restart creates a new shuffled deck and independent Agent root. Menu changes
  require confirmation during an active game. Completed-game Review stays read-only.

## Execution and trust boundary

`game/play.ts` wraps the existing board interaction reducer and Session. Session's
initial deck, accepted actions, and current state remain the canonical timeline;
neither Session nor Core is modified. Selection does not increment state revision.
Accepted actions, restart, and mode changes advance revision; restart/mode changes
also advance generation. Request IDs never reset within the mounted controller.

`game/agent-input.ts` is the original copied/frozen public-input adapter, shared by
browser and Node through a compatibility re-export in scripts/ai-eval. The benchmark
manifest now captures this shared host dependency. Rendering receives public views;
the Worker receives only observation, permitted actions, accepted public history,
fixed perspective, a derived decision seed, Agent identity, and transport tokens.
The policy callable itself still receives only AgentInput and `{ seed }`.

Deck shuffling uses the existing shuffle source outside reducers. A separate
crypto-generated uint32 Agent root stays in the trusted browser coordinator.
WebCrypto reproduces Node's existing HMAC-SHA256/u32le per-player/per-ply schedule.
The root, initial deck, hidden identities, private IDs, and GameState never enter
the Worker. Retry at an unchanged prefix/configuration derives the same seed.

One module Worker per decision provides a simple termination boundary. Module
startup is outside measured policy duration. Any response must match the issued
request/generation/revision/player and offered action by value. The reducer checks
the latest tokens, turn, active/live status and action again, then Session calls
Core at the actual commit boundary. Acceptance consumes the pending request;
duplicate/stale/previous-game responses cannot append actions.

## Failure and cancellation policy

The authorized AI-5 scope uses a conservative pause-and-explicit-retry policy:

- A 10,000 ms host timer covers seed derivation, Worker startup, computation, and
  transport. It is a browser timer guard, not a policy time budget or real-time SLA.
- Timeout, startup/runtime/decoding failure, rejected policy Promise, malformed or
  mismatched reply, and invalid action terminate that Worker and pause the same
  turn. No action/result is fabricated; no other strategy or main-thread policy is
  substituted. Human board input stays disabled on the AI seat's turn.
- **重試 AI** issues a fresh request ID at the same accepted prefix/seed. Restart
  and Menu remain available. There is no automatic retry loop.
- Accepted reply, failure, restart, mode change, and unmount terminate pending
  work. Cleanup is idempotent; late seed completions and disposed callbacks are ignored.
- Browsers lacking Worker/WebCrypto support show the paused recovery UI; local
  two-player mode remains available. Use localhost or a secure origin for WebCrypto.

## Verification

Unit/integration coverage includes both seats and first colors, complete games and
exact replay, terminal Review, Node/WebCrypto seed equivalence, offered-set and
Core validation, duplicate/stale/mismatched replies, invalid actions, failures,
explicit retry, cancellation before/after seed derivation, and unchanged local Undo.

Production-browser tests exercise real policies/Workers and inspect only public
transport, both seats, duplicate/stale replies after restart/mode change, runtime/
timeout/malformed recovery, complete-game Review, and usable controls during a
controlled 1.5-second busy Worker. Browser test instrumentation is injected by
Playwright; no test/debug globals ship in production.

Browser timing samples are written to ignored `test-results/**/ai-worker-metrics.json`.
They distinguish policy duration inside the Worker from postMessage-to-response
round trips (remaining startup/queue/transport included; seed derivation excluded).
Opening smoke samples are not representative full-game or physical-phone latency
measurements. Chromium/WebKit emulation does not close existing physical-device,
hosted-CI, or publication gates. No deployment is part of AI-5 implementation.

Current checks pass: **682 tests across 31 files**, workspace typecheck/lint/format
check/build, and **44 production-browser checks** (22 each Chromium/WebKit). The
WebKit dropdown touch-size regression was fixed with explicit custom select sizing;
the narrow-screen setup test now passes. Release artifact inspection includes the
separate 16,163-byte Worker bundle and finds no bundled verification tooling.

EV opening samples (two decisions each) were 7.6–10.5 ms policy / 11.9–20.1 ms
postMessage round trip in Chromium, and 11 ms policy / 19–28 ms round trip in WebKit
on this Mac. They are not p95 estimates. Local Vite development mode was separately
smoke-tested with real AI turns, both color assignments visible, AI Undo disabled,
and no page errors. The local server is available while the development process runs.

AI-5 implementation and automated verification are complete. Physical-device/hosted
acceptance remains unclaimed. The requested follow-up is the
[AI-6 options review](ai-6-improvement-options.md); no optimization was implemented.
