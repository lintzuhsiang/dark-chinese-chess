# AI-4 — Public projection approval proposal

**Status:** Owner approved the shared Core projection/tests and subsequently the
Core-only commit/pin update. The 11-file extraction is committed and pinned at
b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75. Remaining AI-4 changes stay uncommitted.

AI-4 is authorized. Public inventory/probabilities, the approved Core query, and
EV policy integration are implemented. Pinned full regressions pass; the Phase 2
plan records completed paired comparisons, both exact repeats, all 800 transcript
replays, source/metric audits, and observed static-policy limitations. AI-4 is
complete at this scope; no AI-5 work has begun.

## Missing capability and code evidence

AI-4 requires comparable MOVE/FLIP successor values with terminal correctness.
The AI-3 `evaluateMove` in `packages/ai-agents/src/heuristic-agent.ts` patches the
board, public event, and turn but deliberately preserves ACTIVE/null result.
`getPublicOrdinaryMoves` provides geometry, not next-turn permitted actions or
GameResult. `evaluatePosition` scores a terminal result only when one is supplied.

The authoritative path is `applyAction` in `packages/game-core/src/index.ts`:
`permittedTransition` updates chase, then `evaluateOutcome` checks elimination,
chase-aware immobilization, and finally 60 quiet plies. Its inputs are GameState
and private identity-based chase context. Neither may enter a policy.

Concrete failures of simply extending the AI-3 patch:

- A final FLIP can leave the next side without any move; scoring it as ACTIVE
  misses a terminal win. FLIP resets chase and the quiet counter.
- Capturing the next side's final piece must produce NO_PIECES.
- A quiet MOVE may complete a draw or leave only prohibited chase returns;
  ordinary mobility cannot determine that outcome. Immobilization precedes draw.

## Proposed smallest shared boundary

Add one Core public query, provisionally `projectPermittedPublicAction`, receiving
only PlayerObservation, accepted ActionEvent history, a supplied permitted
GameAction, and a PublicPiece reveal outcome for a FLIP branch. Return the next
PlayerObservation and its ActionEvent. Keep GameAgent/AgentInput unchanged.

Preconditions: observation/history describe the same accepted prefix; the action
is in that prefix's supplied permitted set; a FLIP outcome has positive remaining
public inventory. The query does not select actions or inspect actual hidden
identities. Other hidden squares remain opaque.

Share existing Core transition, capture/geometry, chase, and outcome operations
through the necessary internal public-board/context adapters. Derive the quiet
counter from the accepted event suffix. Reconstruct chase continuity using
references derived from public FLIPs and subsequent MOVEs; these references stay
internal and are unrelated to engine piece IDs. Share outcome priority with
`evaluateOutcome`, including next-turn chase screening. Do not reimplement these
rules inside ai-agents or fabricate a complete hidden deck/GameState.

Expected affected boundary: a new Core public-projection module/export and narrow
internal adaptations in index/transition, chase, outcomes, and validation where
needed to reuse those operations. Preserve all existing Core contracts and rules.
AI code then uses this query for both MOVE and enumerated FLIP branches, with the
same fixed-perspective evaluator and weights. This is one-step evaluation only.

## Alternatives and trade-offs

- **Retain the AI-3 structural patch:** smallest implementation, no Core changes;
  usable for approximate EV, but hypothetical terminal correctness remains absent.
  Requires explicit narrowing of AI-4 acceptance before claiming completion.
- **Trusted runner supplies scored successor data:** avoids giving policies state,
  but expands AgentInput/host responsibilities and requires equivalent Core
  projection capabilities to enumerate FLIPs without actual hidden identities.
- **Separate AI rules or full hidden-state simulation:** duplicates authority or
  introduces out-of-scope machinery; reject these approaches.

Recommend the shared Core query if exact terminal correctness remains required.

## Differential acceptance before integration

1. From legal accepted prefixes, project every supplied MOVE; compare observation,
   public event, next player, assignments, and GameResult with applyAction/getObservation.
2. For every positive-count FLIP color/rank, arrange a valid hidden permutation
   placing that outcome at the selected square. Compare the projection with Core.
   Permuting other hidden identities/IDs must not change public output or scores.
3. Cover both first-FLIP colors, later FLIPs, captures, General/Soldier exceptions,
   Cannon screens/hidden blockers, quiet counter boundaries/resets, and final-FLIP
   immobilization. Test terminal scores for both fixed player perspectives.
4. Cover chase continuation/reset, the prohibited third qualifying return, and
   chase-only immobilization before NO_PROGRESS. Preserve existing chase tests.
5. Run all Core and existing AI/Phase 1 regressions. Keep frozen movement-oracle
   expectations and the benchmark Core guard unchanged.

The owner separately approved the Core-only commit/pin update after implementation
and focused verification. The guard remains strict and now identifies that exact
committed extraction; no EV/CLI/documentation files were included in the commit.

## Implemented boundary

```ts
projectPermittedPublicAction(
  input: PublicProjectionInput, // observation + complete accepted publicHistory
  action: GameAction,
  reveal?: PublicPiece, // required for FLIP; absent for MOVE
): PublicProjectionResult
```

The result is `{ ok: true, observation, event }` or `{ ok: false, error }` using
existing ActionError codes. Input preconditions remain trusted: this is a one-step
query, not a validator/replayer of an entire submitted transcript. It checks
inventory, sequential ply/actor order, turn, and quiet-suffix consistency; malformed
context throws RangeError. Invalid actions/reveal outcomes return typed errors.

- `transition.ts` shares action events, color assignment, turn and counter updates.
  Authoritative/private and public board storage stay separate.
- `rule-position.ts` centralizes the existing board reader and internal reference
  access. Shared validation/chase predicates accept either board representation.
- FLIP/capture resets mean only the quiet suffix needs reconstruction. Undo those
  public quiet MOVEs on a copied board, then replay the suffix through shared chase
  logic. Position-derived temporary references track continuity without private IDs.
- `outcomes.ts` shares elimination/immobilization/draw priority through facts;
  public survivor counts come from initial inventory minus accepted captures.
- `piece-distribution.ts` moves the unchanged inventory constant out of index to
  avoid a circular import. Its existing public export is preserved.

Differential tests include full real accepted prefixes and exact complete-game
replay. Targeted terminal/geometry fixtures explicitly use synthetic capture
ledgers for trusted midgame snapshots; they are not claimed to prove initial-deck
reachability. Their subsequent quiet/chase suffixes are actual Core-accepted actions,
including all 59 quiet plies before draw priority and all 60 before chase-only
immobilization. Existing frozen movement expectations are unchanged.

## Verification and approved commit boundary

- All 397 Core tests pass, including 13 new projection tests. The focused Core,
  Agent, and Phase 1 suite passes: 558 tests across 21 files.
- Workspace typecheck, lint, format check, and production build pass.
- Before the pin update, full suite attempted: 618 passed / 32 failed out of 650, with one unhandled
  rejection. Failures originate from the unchanged b779f98 Core guard (including
  a delayed-Agent test that never starts because runner creation is rejected).
  These were not recorded as passing regressions. After the approved commit/pin
  update, all 650 tests across 28 files pass with no unhandled errors, along with
  typecheck, lint, format check, and production build. No guard bypass was added.
- Benchmark results and verification are recorded in the Phase 2 plan. No other
  commits, pushes, deployment, or AI-5 work occurred. Existing Session/React source
  and game rules are unchanged; browser e2e was not rerun.

The approved single Core-only commit contains exactly these 11 files:

```text
packages/game-core/src/chase.ts
packages/game-core/src/index.ts
packages/game-core/src/outcomes.ts
packages/game-core/src/piece-distribution.ts
packages/game-core/src/public-projection.ts
packages/game-core/src/rule-position.ts
packages/game-core/src/transition.ts
packages/game-core/src/types.ts
packages/game-core/src/validation.ts
packages/game-core/tests/public-projection-fixtures.ts
packages/game-core/tests/public-projection.test.ts
```

The commit is b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75. The authorized update to
scripts/ai-eval/baseline.ts pins that full revision. The pin update, EV/inventory/
CLI implementation, Agent tests, and documentation remain uncommitted. This boundary
authorizes no push, deployment, final AI-4 commit, or AI-5 implementation.
