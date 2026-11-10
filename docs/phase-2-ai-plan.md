# Phase 2 — AI Opponent Plan

**Version:** 0.4 — AI-2 Tournament Harness, 2026-11-10  
**Status:** AI-0/AI-1 complete and committed. AI-2 implemented and verified; owner authorized its commit on phase-2. AI-3 remains unauthorized.  
**Authority:** This plan supersedes the earlier [phase-2-plan.md](phase-2-plan.md) draft.

## 1. Approved Architecture Decisions

- Reuse Game Core and existing GameAction, ActionResult, GameResult, PlayerObservation, and ActionEvent types. Do not introduce PublicGameEvent.
- Agent input contains the player observation, permitted legal actions, accepted public history, and a fixed PlayerId perspective.
- Policies never receive real GameState, hidden identities, internal piece IDs, initial decks, master/deck seeds, or accessors to trusted state. Construct copied public inputs explicitly; readonly types alone do not enforce isolation.
- Game Core remains authoritative for legality and outcomes. Agents propose actions; the host revalidates against the latest state and appends only accepted actions to its canonical timeline.
- Evaluate terminal positions using GameResult and the original evaluating player's perspective. currentPlayer advances even after terminal actions and does not identify the winner.
- Begin with a seeded Random Agent and headless evaluation before advanced strategies. Early policies use deterministic, bounded computation.
- Use browser-first execution with an environment-independent policy boundary. Node runs evaluation; browser Workers run expensive decisions. No AI backend.
- Design generation/revision checks from AI-1. Worker cancellation, hard deadlines, and product failure recovery belong to AI-5.
- Disable Undo only in initial Human-vs-AI mode. Preserve local two-player Undo and other Phase 1 behavior.
- Pin an agreed Core revision for benchmarks. Phase 1.5 public deployment does not block separately authorized headless AI work.

## 2. Contract and Execution Boundary

The following contract is approved for AI-1. Initial policies are deterministically bounded; no time-budget or remote-execution options are introduced.

```ts
interface AgentInput {
  readonly observation: PlayerObservation;
  readonly legalActions: readonly GameAction[];
  readonly publicHistory: readonly ActionEvent[];
  readonly perspective: PlayerId;
}

interface GameAgent {
  chooseAction(input: AgentInput, options: { readonly seed: number }): Promise<GameAction>;
}
```

- Call only for the assigned player's ACTIVE turn with a nonempty permitted-action list. Compare proposals by value, not object identity.
- Public history is exactly the accepted prefix at the decision. Derive captures and public rule context from it; never supply completed-game future history or raw private chase state.
- Keep perspective fixed while hypothetical successors advance the turn. For the first FLIP, colors are unassigned; each reveal branch assigns P1 its revealed color, P2 the opposite, then advances to P2.
- Use independent deck and Agent random streams. Benchmark manifests may retain trusted deck seeds; Agent inputs must not.
- Keep request ID, game generation, and monotonic revision in the host/execution envelope. Recheck at commit; reject stale or duplicate responses. Action count alone is insufficient after undo or branching.
- A Promise does not provide CPU isolation. Early computation is bounded without wall-clock-dependent decisions; AI-5 defines Worker lifecycle and recovery.

### Final AI-0 seed and revision decisions

- The trusted runner accepts separate unsigned 32-bit deckSeed and agentSeed roots. Callers choose them independently. Deck shuffling uses a fresh Mulberry32-v1 stream and the existing shuffled-deck utility; policies never receive either root.
- Each decision seed is the first four digest bytes interpreted as unsigned little-endian from HMAC-SHA256. The UTF-8 key is the decimal agentSeed; the UTF-8 message is JSON.stringify(["dark-chess-agent-decision-v1", playerId, plyCount]). Record this as hmac-sha256-u32le-v1. Policies use a fresh Mulberry32-v1 stream per decision and select floor(sample * legalActions.length).
- Decision seeds depend on accepted ply and player, not request IDs, generation, revision, or shuffle draws. Restart/replay therefore preserves decisions for identical roots and action prefixes. No wall clock or uncontrolled randomness enters policy computation.
- Each runner creation/restart obtains a fresh process-local generation; state revision starts at zero and increases on each accepted action and restart, never resetting during that runner's lifetime. Request IDs also increase. A newly issued request supersedes the previous pending request.
- Commit requires the current generation/revision, pending request ID and player, an action from the issued permitted set, and successful Core validation. Acceptance consumes the pending request; duplicates, superseded requests, and mismatches cannot commit. Invalid responses leave authoritative state/timeline unchanged.
- AI-1 assignments are fixed for a runner. Changing Agents/configuration creates a new runner/generation; no Undo or branch-editing API is added. These transport tokens stay outside chooseAction inputs/options.

### Reproducible Core baseline

Pin commit **34452df2bc198d382e36399218d2cfcb9e95f3f3** (release quality gates and chase-only immobilization correction). Core and rules files match this commit; the existing Core/outcome integration checks passed before AI-1. No Core commit or worktree was required. Work proceeds on branch phase-2; both planning documents are preserved in the AI-1 commit.

Runner metadata records this pin, randomness versions, roots, and environment. Before a match, verify the checkout's Core/rules match the pin; unrelated Phase 2 changes do not invalidate the Core baseline. Never label a later modified Core with this revision.

## 3. Verified Chase Counting Convention

The approved threshold is **reject the third qualifying return**, equivalently reject the candidate **fourth qualifying appearance of that same logical threat position**. The first appearance establishes zero completed returns.

With Red Chariot 0 and Black Horse 5, P1 first moves Chariot 0→1 to establish threat position A (Chariot 1, Horse 5, P2 next). Other pieces stay stationary and no extra eligible target changes the chase.

One return to A is: Horse 5→4; Chariot 1→0; Horse 4→5; Chariot 0→1.

| Candidate appearance of A | Returns if accepted | Decision                                       |
| ------------------------- | ------------------- | ---------------------------------------------- |
| Initial threat: 1         | 0                   | Accept; store count 1                          |
| First return: 2           | 1                   | Accept; store count 2                          |
| Second return: 3          | 2                   | Accept; store count 3                          |
| Third-return candidate: 4 | 3                   | Reject final Chariot 0→1; stored count stays 3 |

Only the initial threat and qualifying renewals count. Defender escapes and general board repetitions do not. Counts apply to every qualifying threat-position key within the continuous chase, including later loops elsewhere; resets and physical-pair continuity follow the existing rules.

Evidence: [game-rules.md §10](game-rules.md#10-perpetual-chasing-長捉--simplified-house-rule), [chase.ts](../packages/game-core/src/chase.ts) initializes count 1 and rejects candidate counts greater than 3; [chase.test.ts](../packages/game-core/tests/chase.test.ts) covers zero initial returns, two accepted returns, rejected third return, alternate routes, and later loops. [outcome-integration.test.ts](../apps/web/tests/outcome-integration.test.ts) verifies legal-action filtering and unchanged state/timeline on rejection.

The approved chase-aware immobilization amendment also remains in force: an accepted action leaving the next player without any permitted action ends with NO_LEGAL_ACTION, before NO_PROGRESS. A rejected attempt does not itself adjudicate a game. The sequence above assumes alternatives remain; the separate Cannon regression tests terminal resolution when none remain. This plan changes no rules.

## 4. Evaluation and Public Projection

### AI-3 baseline

Start with Material, Immediate Threat/Safety, and Basic Mobility. Use pure public-information functions with explicit weights, comparable scales, and diagnostic breakdowns.

- Material includes hidden survivors: initial distribution minus public captures. Revealing creates no material; do not add a second full capture bonus after material already reflects the capture.
- Threat/Safety respects General/Soldier exceptions and Cannon geometry. Avoid counting the same exposed victim repeatedly.
- Mobility excludes FLIPs. Distinguish ordinary structural mobility from chase-filtered permitted actions.
- Define a complete Heuristic policy, including first FLIP and a documented later FLIP fallback. Do not claim its fallback is expected-value scoring.

### AI-3 Core-change approval gate

Do not extract public-rule primitives in AI-0, AI-1, or AI-2. When concrete AI-3 requirements exist, present before changing shared Core code:

1. Exact missing public capabilities, including any successor, tactical, or chase-aware terminal information actually needed.
2. The smallest shared rule boundary and affected interfaces.
3. Alternatives and costs: use supplied actions for a narrower evaluator, share existing rule primitives, or another justified public projection.
4. Differential tests against authoritative Core behavior, including first-flip assignment, captures, counters, Cannon screens, chase continuity/resets, third-return prohibition, and terminal priority.

Use trusted test fixtures to compare public MOVE projections with applyAction/getObservation; test FLIP branches using valid hidden permutations consistent with the same public prefix. Policies must not receive these full test states. Any continuity references must derive from public events, not engine IDs.

Do not build a second independent rule engine or a complete hidden-state simulation framework. Projection types, necessary public chase context, and extraction scope remain AI-3 decisions.

### AI-4 FLIP expected value

For color/rank type t:

```text
hiddenCount(t) = initialCount(t) - capturedCount(t) - currentlyRevealedCount(t)
P(t at x) = hiddenCount(t) / totalHiddenCount
Q(MOVE) = V(public successor, fixed perspective)
Q(FLIP x) = sum over t of P(t at x) * V(public successor revealing t, fixed perspective)
```

Assume uniform shuffling without remembered undone disclosures. Enumerate only positive-count outcomes; verify conservation, normalized probabilities, and zero-hidden handling. Use the same evaluator and units for MOVE and FLIP, including next turn, first-flip assignments, and approved terminal semantics. Probability weights outcomes rather than adding an arbitrary static feature.

## 5. Evaluation Harness and Experiments

- Reuse the AI-1 match runner; call Core directly without React. Retain one canonical accepted timeline and derive public history from successful transitions. Replay must reproduce states, events, and GameResult.
- Pair games on the same deck with Agent seats P1/P2 exchanged. Separate shuffle and per-Agent randomness; record the seed schedule and PRNG/shuffle versions.
- Report attempted games/pairs, completed games/pairs, W/D/L, scored-game average (win 1, draw 0.5, loss 0), sample sizes, and uncertainty respecting paired results.
- Retain every failed, timed-out, and administratively truncated match with its reason. Distinguish execution outcomes from GameResult; do not silently discard failures, invent draws, or substitute another Agent. State scoring denominators and any administrative scoring policy.
- Measure Agent decision latency p50/p95 separately from input preparation and Core execution. Record illegal-action rate, errors, budget overruns/timeouts, and hidden-information independence.
- Manifests record agreed Core revision, rules/source identity, Agent version/configuration, seeds, randomness versions, computation limits, runner version, and evaluation environment (runtime, OS/hardware or browser/device).
- Fixed inputs/seeds reproduce decisions, scores, and results; latency need not be identical. Bounded early policies do not require hard CPU-preemption infrastructure.
- Keep tuning and held-out evaluation seeds separate. Compare feature ablations on the same held-out pairs; retain raw results. Do not infer strength from a handful of games or use statistical strength as a flaky unit-test gate.
- Hidden permutations must preserve the public prefix and legal piece distribution. Compare complete public inputs, scores, and decisions before revelation; actual games may diverge after different pieces are revealed.

## 6. Implementation Tasks and Dependencies

**Authorization:** AI-0/AI-1 were committed as 24b7e1228b2095443794daf0ee4c5653f4dad056 under explicit owner approval. The owner subsequently authorized committing the verified AI-2 implementation on phase-2. Do not begin AI-3, commit further work, push, or deploy without approval.

| Task                                   | Scope / dependency                                                                                                                                                                   | Acceptance and verification                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-0 — Contract alignment              | Agree input/signature, trust boundary, Core revision, seed ownership, and generation/revision semantics. Record deferred AI-3/AI-5 decisions.                                        | Meet the completion checklist below; review first FLIP, terminal perspective, chase threshold, and stale-response examples. No Core extraction.                                                         |
| AI-1 — Random Agent and minimal runner | After AI-0 and explicit implementation authorization: seeded uniform selection from supplied permitted actions; public input adapter; one headless match loop; host revision checks. | Zero illegal actions; fixed-seed reproducibility; independent randomness; hidden-permutation invariance; full legal games and exact transcript replay; delayed/duplicate/stale proposals cannot commit. |
| AI-2 — Tournament Harness              | Extend AI-1's runner with paired scheduling, metrics, manifests, and JSON reports; establish Random baseline.                                                                        | Independent metric/accounting tests, correct result perspective, paired seats, retained failures/truncation, reproducible actions/results, replay consistency. No second runner or React requirement.   |
| AI-3 — Heuristic baseline              | After AI-2 baseline: present the Core-change proposal if needed; implement approved public evaluation and three initial features; complete FLIP fallback.                            | Public-only inputs, explainable scales, tactical/symmetry fixtures, approved differential tests, first held-out comparison. Shared Core changes require separate approval.                              |
| AI-4 — FLIP expected value             | After AI-3 projection/evaluator: public hidden-count distribution, reveal branches, common MOVE/FLIP scoring.                                                                        | Probability/conservation tests, both color assignments, next-turn and terminal correctness, hidden-permutation invariance, reproducible decisions and comparison report.                                |
| AI-5 — Browser integration             | After validated headless strategies: Human-vs-AI mode, Worker execution where needed, human-seat guards, cancellation, deadlines/recovery, and stale-response handling.              | Responsive target devices; no stale/duplicate commit; runtime revalidation; Undo disabled only in AI mode; local play preserved; failure policy approved/tested. Difficulty labels require evidence.    |
| AI-6 — Evaluation and optimization     | Reporting begins at AI-2; final comparison follows AI-4 and browser measurements. Incremental feature experiments follow baseline evidence.                                          | Random/Heuristic/EV comparison, paired confidence intervals, held-out ablations, device latency, reliability/failure accounting, limitations, and evidence-based next steps.                            |

Algorithm order: **AI-0 → AI-1 → AI-2 → AI-3 → AI-4 → AI-5**. AI-6 reporting runs from AI-2 onward; its final report includes AI-5 measurements. After contracts stabilize, independent QA and evaluation/reporting work can run in parallel with strategy work. Keep Core/contracts under one owner and partition files; do not interfere with Phase 1/1.5 work.

### Exact AI-0 completion criteria

- [x] Owner approved the Agent callable signature, input invariants, seed ownership, and host-only execution envelope.
- [x] Pin Core revision 34452df2bc198d382e36399218d2cfcb9e95f3f3 containing the amended chase-aware NO_LEGAL_ACTION behavior; verify Core/rules match it.
- [x] Confirm existing API reuse, one timeline owner, public-history derivation, first-flip behavior, fixed terminal perspective, and chase counting with existing tests.
- [x] Record generation/revision advancement and commit checks, including restart, superseded/duplicate responses, and new generations for changed Agent configuration. No branch-editing API is needed in AI-1.
- [x] Owner authorized AI-1 scope and acceptance scenarios below; shared Core remains untouched.
- [x] Record AI-3 extraction and AI-5 cancellation/recovery as deferred approval gates. AI-1 implementation is explicitly authorized.

### Exact AI-1 implementation scope

Deliver the Agent types/seeded Random policy, an explicit public-input adapter, and one minimal Node match runner with private Core state, accepted actor/action transcript, derived public events, and generation/revision validation. Reuse createInitialState, getObservation, getLegalActions, applyAction, and existing reconstruction for replay verification.

Approved file ownership: new packages/ai-agents for policy/types/tests and scripts/ai-eval for the trusted adapter/runner/tests, plus necessary workspace/typecheck/test wiring. Existing Core, Session, and UI application code stays unchanged.

Verify deterministic single decisions and complete seeded matches, both seats/colors, opening FLIPs, structural action membership, immutable public inputs, independent Agent/deck randomness, hidden permutations, exact replay, and rejection of delayed/duplicate/stale responses even when action counts match. Under the amended rules, an accepted ACTIVE state with no permitted actions is an invariant failure, not an invented match result.

Do not include heuristics, public successor simulation, Core extraction, full tournament reporting, UI/mode changes, Undo changes, Workers, cancellation/recovery policy, backend services, or new external dependencies. AI-2 extends this runner rather than replacing it.

### AI-1 delivery and verification

- Delivered the approved policy package, frozen public-input adapter, trusted request/commit runner, versioned seed derivation, Core baseline guard, replay verifier, and focused tests. See [runner usage and limitations](../scripts/ai-eval/README.md).
- The existing Core, local Session, React UI, dependency versions, and lockfile are unchanged. Only new AI files and necessary root TypeScript/Vitest inclusion were added alongside this plan revision.
- Verification passed: lint, formatting, workspace typecheck, all **507 tests across 17 files** (including 54 new AI tests), production build, and Core/rules comparison with the pinned revision.
- A fixed replay fixture (deckSeed 1543, agentSeed 7) completes 199 accepted plies with P1 winning NO_PIECES while currentPlayer is P2. Tests cover hidden permutations around captures/chase, first flip, both seats, invalid/stale/duplicate responses, cross-runner generations, delayed responses, and transcript/event/full-state/result tampering.
- Two subagents handled isolated policy/adapter development and independent QA; main owned baseline, runner, seed protocol, wiring, and integration. QA's mutable-options provenance finding was fixed by capturing configuration before the first await.
- Existing cached tooling was restored offline after pnpm unexpectedly reconciled the added workspace package: 161 existing packages reused, zero downloads, frozen lockfile unchanged. No new dependency was added.
- The AI-1 milestone was subsequently committed with owner approval; CLI/tournament work is covered by AI-2 below. Browser execution and hard timeouts remain deferred. No push or deployment was performed.

### AI-2 implementation decisions

- Extend the existing runMatch loop with Agent-only latency samples and retained runner/Core invariant failures; preserve Core, Session, UI, and the Agent interface.
- One pair per distinct deck seed swaps A/B seats on the same deck. Both legs share a per-pair Agent root derived with HMAC-SHA256 message ["dark-chess-pair-agent-v1", pairIndex], independently of deck seeds; AI-1 per-player/per-ply derivation is unchanged.
- Every attempted game remains visible. Completed-game W/D/L and mean use completed legs; paired inference uses only pairs with both legs completed. Invalid actions, Agent exceptions, invariant failures, and administrative truncations are unscored execution outcomes, never draws.
- Confidence intervals use Hoeffding bounds over bounded pair scores, not individual legs: radius sqrt(log(2 / (1-confidenceLevel)) / (2 * completePairs)), clipped to [0,1]. No randomized CI procedure is used. Independent representative pair sampling is an assumption; distinct deterministic seeds alone do not establish it. Incomplete-case bias and denominators remain explicit.
- JSON manifests identify Core pin, Agent/configuration and runner versions, Git HEAD/dirty status, exact selected source hashes, dirty tracked patch/deletions, untracked source bytes, seed versions/schedules, limits, and environment. End-of-run source checks flag changes during execution.
- CLI compares labeled Random Agents without introducing another strategy. Reports go to ignored benchmark-results; latency includes policy work/Promise settlement and excludes input preparation/Core commit. Hard timeouts, process isolation, cancellation, and budgets remain outside AI-2.
- See [runner documentation](../scripts/ai-eval/README.md) for command, report interpretation, assumptions, and limitations.

### AI-2 verification record

- Repository typecheck, lint, format check, all **562 tests across 22 files** (55 additional AI-2 tests), and production build passed. Core, existing Session/UI, Agent policy/interface, dependency versions, and lockfile remain unchanged.
- The standalone Node CLI completed 20 pairs / 40 games using deck seeds 1543–1562 and Agent root 7: A W/D/L 5/30/5, mean 0.500, paired 95% Hoeffding interval [0.196, 0.804], 10,126 decisions, and zero illegal actions, Agent errors, invariant failures, or truncations.
- A repeat command reproduced actions, final outcomes, and scoring; all 40 first-run transcripts replayed exactly. Both source snapshots were stable during execution. Their dirty-source manifests archive 12 untracked source files plus the tracked source patch against the AI-1 commit; they do not claim the working tree was clean.
- Evaluation and independent QA subagents owned separate files. QA reviewed pair-level inference and accounting and identified source-archive edge cases, which were fixed. Main verified CLI execution and the timing boundary with a controlled-clock test.
- Verification was performed before the owner authorized the AI-2 commit. Generated benchmark JSON reports remain ignored by Git. No AI-3, push, or deployment was performed.

## 7. Research Extensions

**Planned feature experiments:** Retain Relative Position (distance, accessibility, support) and Board Geometry (particularly hidden-piece blockers and Cannon screen structures) on the roadmap. Add one at a time after the baseline, with explicit feature ownership, cost measurements, and held-out ablations. Deferring extra geometry scores does not defer correct blocker/screen rules.

**Future algorithm research:** Hypothetical complete states, hidden-state sampling, Monte Carlo rollouts, MCTS/information-set search, and learning remain outside initial implementation and acceptance. Require benchmark evidence and separate approval before adding infrastructure. Samples must use only public constraints, conserve piece counts, and give simulated policies only simulated observations; account for determinization/strategy-fusion bias.

Phase 2 completion requires a usable browser opponent, public-only policies, reproducible baseline/comparison reports, verified rule consistency, failure accounting, and measured responsiveness. It does not require proving the AI strong or implementing the research extensions.

## 8. Remaining Open Decisions

- **AI-0:** Complete; contract, seed schedule, revision semantics, file scope, and Core pin are recorded above.
- **AI-2:** Complete-case scoring, paired Hoeffding intervals, seed schedule, source manifest, and failure categories are defined above. A small Random baseline verifies the harness; broader sample sizes, held-out sets, and strength claims remain experiment-specific.
- **AI-3:** Concrete missing public capabilities, minimal shared boundary, public continuity/chase context if required, differential-test cases, feature scales/weights, and complete Heuristic FLIP fallback.
- **AI-5:** Worker cancellation, timeouts, failure recovery, human-seat UX, and evidence-based difficulty settings.

Revisit backend or advanced search only when measured limitations justify a separately approved proposal. Authorization covers AI-2 implementation only; AI-3, new dependencies, further commits, pushes, and deployment require separate approval.
