# Chase v4 specification

Approved on 2026-11-12. This document is the current Chase specification.
The v3 design, implementation reports, original replays and benchmarks are
historical evidence only; they do not define v4 behavior.

## Qualifying threat and key

An otherwise legal non-capturing MOVE by a revealed physical piece A qualifies
for each revealed enemy physical piece B when A can capture B after the move,
A could not capture B immediately before it, and B cannot capture A afterward.
Use ordinary capture geometry and occupancy, independently of turns and chase
restrictions, including Cannon screens (hidden screens are occupancy only).
Reciprocal attacks, continuing existing attacks, discovered attacks by another
piece, FLIPs and captures do not produce qualifying records.

Each record is keyed by `[physical A, physical B, A's post-move square,
B's post-move square]`. Different physical pieces and different coordinate
pairs count separately. Other pieces, whole-board arrangement and the other
targets of a fork are not part of this key.

The first qualifying threat counts immediately. Initial forks record each
qualifying target independently; no immediate escape/renewal sequence is required.
If any target of a candidate fork violates the rule, reject the entire MOVE
atomically with `PERPETUAL_CHASE`.

## Rolling window and transitions

For candidate accepted ply p (`before.plyCount + 1`), count matching qualifying
records in the inclusive interval `[p - 19, p]`, including the candidate itself.
Reject the third qualifying appearance. An old record at p-19 counts; one at
p-20 does not. Retain only records in this window on accepted transitions.

Both players' accepted actions advance the window, including unrelated quiet
moves, FLIPs and captures. Such actions never directly clear surviving records.
There is no PASS action; waiting means spending plies on other legal actions.
No permanent pair allowance or support-based restoration exists. Once old
records age out, the same key can qualify again. Legal captures always bypass
chase prohibitions and add no qualifying records.

Rejected actions do not advance turns, counters, accepted history or the chase
ledger. Legal-action enumeration and submission must use the same screening.
The ledger is immutable and bounded by the last 20 plies, including independent
records for fork targets and both players.

## Public projection and replay

Preserve the opaque public projection context API and its independent branches.
Public reconstruction uses the complete accepted prefix, assigning stable public
references from reveal events. Private piece IDs and hidden identities must not
enter observations, public events or serialized contexts. Authoritative Core,
full-prefix projection and incremental context branches must agree.

Undo, replay and restart reconstruct v4 state deterministically from the accepted
prefix. This implementation provides v4 replay only, with no v3 compatibility
engine. If an old replay contains a v4-illegal move, fail explicitly at that ply;
never skip the action, report a truncated prefix as success, or relax v4 rules.
Keep old Core revisions, original replays and historical benchmarks intact so
they can still be reproduced with their matching old version. Never relabel old
results as v4 results. The existing Core pin and strict baseline guard stay intact.

## Terminal outcomes

Keep this priority for authoritative and public transitions:

1. `NO_PIECES` win.
2. Ordinary `NO_LEGAL_ACTION` win (before chase filtering).
3. `CHASE_STALEMATE` draw if ordinary actions exist but all are chase-prohibited.
4. `NO_PROGRESS` draw at the existing threshold.

Do not add a draw for an inability to force a win.

## Performance architecture constraints

Preserve the current EV and Tactical public-context paths. Reconstruct the full
accepted history only once at the start of a decision. Tactical's EV fallback
and search root share that context; every child advances incrementally from its
parent context. Never reconstruct full history per candidate action, FLIP outcome
or child node. Contexts remain local to a decision; no cross-turn delta is added.

Add regression tests counting full-history reconstruction and incremental public
projections: increasing projections must not increase reconstruction count.
Cover EV's candidate/outcome expansion and Tactical's deeper descendants.
Keep the existing search depth, 8,192-projection budget, root/interior candidate
widths and evaluation scores. Do not tune these to conceal performance problems.

## Change inventory and implementation scope

| Keep                                                        | Replace or remove                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Ordinary new, non-reciprocal capture-threat geometry        | v3 active escape/renewal phases                                             |
| Physical identity continuity; public reveal references      | Permanent `exhaustedPairs`                                                  |
| Immutable rejection and shared legal-action filtering       | `pendingSupport`, witnesses, spent witnesses and revalidation               |
| Public projection context and complete-prefix validation    | Whole-board/fork-set qualifying-position counts                             |
| Existing terminal order and ordinary captures               | Chase resets on progress or interruptions                                   |
| Old v3 documents, revisions, replays and benchmark evidence | Current rule documentation and obsolete v3 behavioral assertions            |
| AI-6A search configuration and scoring; Core pin            | No AI-6B work, cross-turn delta, pin updates, commits, pushes or deployment |

Implement a small timestamped qualifying-record ledger, update current rule
documentation, adapt affected tests to v4, and add boundary/identity/fork/replay
and public-parity coverage. Keep historical fixtures available without claiming
their old results are current v4 results. Run lint, formatting, type checking,
unit tests, build, relevant browser flows and release-artifact checks. Report
checks blocked by the unchanged old Core pin separately from v4 verification.

## Implementation verification — 2026-11-12

The implementation uses `ChaseState.records`, with no active/exhausted/support
state. Both public projection APIs retain their existing signatures. Tactical
shares one root context with its EV fallback; child nodes use parent contexts.
No search defaults, widths, scoring or projection budget changed.

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` and
  `pnpm verify:release` pass. The artifact check does not authorize publication.
- `pnpm test:e2e`: all 56 Chromium/WebKit tests pass, including v4 chase
  rejection, FLIP/Undo persistence, alternate coordinates, Review and AI Workers.
- The focused Core/replay/context-cost suite passes all 41 tests. It covers each
  coordinate independently, physical identity, forks, window boundaries and
  expiry, interruptions, capture exemption, terminal priority, exact-ply replay
  failure and reconstruction cost independent of projection count.
- `pnpm test`: 752 pass, 32 fail, plus one unhandled rejection. All failures are
  in the old-pin runner/tournament/CLI paths; the unhandled rejection has the same
  baseline-guard cause. This is not a fully passing test run.
- Excluding the six pin-dependent files yields 35 passing files / 714 passing
  tests with no unhandled errors: `cli`, `independent-invariants`,
  `runner-observation`, `seeds-and-failures`, `tournament-invariants` and
  `tournament` under `scripts/ai-eval/tests/*.test.ts`.
- Core pin remains `b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75` and the strict guard
  is unchanged. Runner/replay integration, tournament and historical benchmark
  commands remain blocked by that pin; no guard bypass or result relabeling was
  used. Core/public-context and session reconstruction tests run directly on v4.
- Historical v3 documents, fixture transcripts, AI-6A reports and diagnostic
  artifacts remain intact. No historical benchmark was rerun or overwritten.
