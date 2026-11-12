# Chase v3 implementation — paused at the performance gate

Owner approved the specification on2026-11-12. Core implementation and focused
verification have started; **this is not a completed or browser-ready migration**.
The owner explicitly required stopping for a reconstruction optimization proposal
if correct full-history projection caused substantial AI-6A latency regression.
That condition was measured. No optimization or browser promotion is implemented.

## Implemented before the gate

- `packages/game-core/src/types.ts`: four-part ChaseState; DRAW adds
  CHASE_STALEMATE. Public observation/event/action and GameAgent shapes unchanged.
- `chase.ts`: independent fork pairs, continuous partial counts, persistent
  exhausted pairs, third qualifying-position prohibition, one-use DIRECT/ESCAPE
  support, next-own-action expiry and causal revalidation on current/candidate
  boards. Captures exempt; unrelated progress never refunds exhaustion/witnesses.
- `outcomes.ts` and `index.ts`: separate ordinary/permitted availability, with
  NO_PIECES → ordinary NO_LEGAL_ACTION → CHASE_STALEMATE → NO_PROGRESS priority.
- `public-projection.ts`: replay full accepted public prefix using shared chase,
  geometry and outcome semantics; reveal-origin references only, reveal inventory,
  metadata/board/assignments/turn and intermediate terminal checks. No private deck
  or identity enters the projection or policy.
- `tests/chase.test.ts`: replaced old single-pair/fourth-appearance expectations
  with approved v3 tests. `tests/chase-v3-fixtures.ts` and
  `tests/chase-v3-public.test.ts`: actual full-deck accepted prefixes through
  exhaustion, progress, support earning/redemption/reuse rejection; exact replay,
  private/public permitted-set parity and hidden permutation tests.
- `verification/chase-v3-latency.ts`: comparable local measurement tool, separate
  from guarded tournaments. It records actual Core source hashes and unchanged
  tactical-search hash, without asserting that dirty HEAD is the new Core revision.

The new public support integration uses a Red Chariot helper (physical piece
initially20). Its real capture route clears21→17→13→9. After moving back to13,
the quiet13→9 establishes a new direct attack on Black Horse5. The original
Red Chariot0→1 is permitted once using that support, retaining its exhausted pair.
A later identical helper toggle cannot earn another DIRECT witness. All setup
FLIPs/captures/MOVEs are Core-accepted, not an invented capture ledger.

## Correctness evidence and remaining checks

Focused Core verification: **62 tests pass across three files**:

```sh
node_modules/.bin/vitest run packages/game-core/tests/chase.test.ts packages/game-core/tests/chase-v3-public.test.ts packages/game-core/tests/outcomes.test.ts
node_modules/.bin/tsc -p packages/game-core/tsconfig.json
```

These cover first/second/third pursuit, initial/renewed forks, interrupted partial
counts, changing positions, third fork appearance, waiting/progress persistence,
rank/Cannon/hidden-screen geometry, direct capture, support bundles/spending/expiry,
rejection/enumeration immutability, terminal priority and the avoidable draw incentive.
Differential tests compare actual events/results and all candidate actions at a
real accepted-history support-reuse position. They also check public output for
reference/ledger leakage. Private replay reproduces the entire final ledger/event
prefix exactly. This is focused evidence, not exhaustive acceptance completion.

Workspace lint, formatting and build pass. Core package typecheck passes.
Workspace/AI/Web typechecks currently fail because old-rule test assertions still
reference removed single-pair fields. These tests are deliberately not made to pass
by adding compatibility fields or weakening the new rule. The full suite reported failures in old-rule transcripts/expectations, synthetic
public histories and a real-prefix projection timeout. It was then interrupted
(exit130) at this performance stop, without a complete aggregate result. No full
suite pass is claimed; raw output remains in the test log.

Pending after the performance decision: version/migrate legacy chase diagnostics,
old-rule accepted transcripts and synthetic tactical capture ledgers; complete
remaining stale/support/symmetry fixtures; verify Session Undo/branch/restart/Review,
Worker and full Tactical Agent regressions; update UI draw text to distinguish
CHASE_STALEMATE; update authoritative rule/product/architecture documentation and
verify harness/training result preservation. No browser E2E or physical-phone
readiness is claimed. The current App still assumes every draw is NO_PROGRESS.

## Comparable old/new AI-6A latency

Local Node measurements, same machine/runtime, exact decks, accepted prefixes,
seeds0/1/2 and default tactical settings: depth6, projection budget8,192 and
root/interior widths8/4. No scoring, candidate ordering or search configuration
changed. A projection has one warmup; decisions have no dedicated warmup. Three
samples per position are descriptive, not reliable tail estimates or confidence
intervals. No strength benchmark is claimed.

| Workload                          | Accepted history | Old decision median | v3 decision median |  Ratio | Old/new completed depth | Projections per decision |
| --------------------------------- | ---------------: | ------------------: | -----------------: | -----: | ----------------------- | ------------------------ |
| Opening                           |                0 |             86.88ms |            91.40ms |  1.05× | 1 /1                    | 8,192 /8,192             |
| Early reciprocal position         |                7 |             73.20ms |           141.44ms |  1.93× | 1 /1                    | 8,192 /8,192             |
| Middle with hidden pieces         |              115 |            105.91ms |         1,492.64ms | 14.09× | 1 /1                    | 8,192 /8,192             |
| Long accepted history             |              547 |            283.26ms |         7,332.09ms | 25.88× | 3 /3                    | 8,192 /8,192             |
| Six-piece, fully revealed endgame |               88 |             75.65ms |         1,301.67ms | 17.21× | 6 /6                    | 2,347 /2,355             |

The88-ply endgame uses deck/generator seed81000; generation prioritizes captures,
then FLIPs, then seeded quiet actions. Both engines independently accept the exact
same prefix. Its v3 decision samples range1,146–4,434ms, showing substantial local
variation; do not interpret the median as a deadline guarantee. The original
176-ply sacrifice prefix is also retained in raw results: v3 rejects it at ply32
with PERPETUAL_CHASE. It is explicitly **excluded** from comparable latency ratios,
not silently replayed with relaxed rules or relabeled as the new endgame.

Root one-projection medians (20 measured repetitions after one warmup):

|    History |      Old |       v3 |
| ---------: | -------: | -------: |
|          0 | 0.0135ms | 0.0173ms |
|          7 | 0.0085ms | 0.0250ms |
|        115 | 0.0367ms | 0.1907ms |
|        547 | 0.0049ms | 0.8505ms |
| 88 endgame | 0.0475ms | 0.5723ms |

The long-history projection cost alone increases about174×. Full replay repeats
transition/chase/outcome validation for the common accepted prefix in every
projection. It also repeats that work for sibling actions and hypothetical search
prefixes. The measured history-dependent cost, with unchanged search source and
matching long-workload projection counts/depths, justifies the optimization gate.
Some search trees differ under the new rules, so endgame decision ratios are not a
pure reconstruction-only microbenchmark. No browser timing is substituted for these
Node measurements; Worker latency remains pending after this gate.

Raw ignored artifacts:

- `benchmark-results/chase-v3-workloads.json`: exact decks/actions, including the
  incompatible historical prefix and shared88-ply endgame.
- `chase-v3-latency-old.json`, `chase-v3-latency-v3.json`.
- `chase-v3-latency-old-endgame.json`, `chase-v3-latency-v3-endgame.json`.
- `chase-v3-{typecheck,ai-typecheck,web-typecheck,lint,format-check,test,build}.log`.

The original old-Core measurements were captured before edits. Endgame comparison
loads the exact nine old Core source files from Git revision
`b3e7b2b139f0e8d9598876cc3a9b00d2bf032f75` into a temporary directory using a
measurement-only Node resolution hook. Their hashes match the original old-Core
manifest. No worktree/branch/commit/pin was changed. Tactical-search SHA256 is
`04cf9e4aae5d92632e40f5c63ac202c5d09847cd2538c0bf74dc0f5f1b139474`
in every measurement. New Core is an uncommitted source snapshot, not a Git revision. Its source-set
SHA256 is `2e2d1eb4a26eee2938471cd6861f80d90807b7e5fdaee3a77f32378b6ce710b7`
(hash UTF-8 sorted `filename:sha256` lines joined by newline, without final newline).
This identifies the measured implementation and does not replace CORE_REVISION.
The reusable `verification/chase-v3-frozen-core.mjs` loader performs the same fixed
Git-source extraction into ignored benchmark-results without changing Git state:

```sh
node --import ./scripts/ai-eval/register.mjs --import ./verification/chase-v3-frozen-core.mjs verification/chase-v3-latency.ts old common-endgame
node --import ./scripts/ai-eval/register.mjs verification/chase-v3-latency.ts v3 common-endgame
```

Omit `common-endgame` to measure the entire saved workload bank. These commands
replace only their explicitly named local measurement reports; historical AI-6A
strength reports remain untouched.

## Minimal proposed optimization — approval required

Add a small **public-derived projection context** with two operations:

1. Construct from the complete public observation/history once, retaining the same
   strict full replay, inventory, event, terminal and observation validation.
2. Advance by a permitted action and optional positive-inventory public FLIP
   outcome through the **same shared authoritative transition/chase/outcome path**;
   return public observation/event and a new immutable child context.

Proposed narrow API (names subject to routine implementation review):

```ts
createPublicProjectionContext(input: PublicProjectionInput): PublicProjectionContext;
projectPublicAction(context: PublicProjectionContext, action: GameAction, reveal?: PublicPiece):
  PublicProjectionFailure | { ok: true; observation: PlayerObservation; event: ActionEvent; nextContext: PublicProjectionContext };
```

The context holds only public board/reveal-origin continuity, the four history-derived
rule maps, counts and turn/assignments. It never holds a real GameState, hidden
identities, initial deck, actual deck IDs or seeds. Keep it opaque to evaluation;
no heuristic reads or edits its ledger. Every child/sibling has immutable independent
state. Do not shorten accepted history or infer a ledger from the final board.

Keep `projectPermittedPublicAction(input, action, reveal)` as the fully validating
compatibility wrapper. Add the narrow context API inside Core and integrate it only
where repeated projections need it: construct once for the EV root baseline and
once for the Tactical root, then carry child contexts through existing search
nodes. Share the same root context where practical without changing decisions.
Do not alter GameAgent/AgentInput, Worker messages, depth, budget, widths, scoring,
chance outcomes, candidate ordering, fallback, or projection accounting. Context
construction/replay is input preparation, not an uncounted hypothetical projection;
every actual projected action still counts toward the same8,192 budget.

This introduces one explicitly reviewed public-derived context boundary, not another
rule engine, general search framework or opaque private-state shortcut.

Alternatives:

- Root-object/array identity memoization avoids some sibling replay but not each
  hypothetical prefix; it also needs careful mutation/validation semantics. A
  hidden global cache makes provenance and stale-input behavior harder to audit.
- Prefix hashes or last-event identity caching need collision/mutation/prefix
  validation safeguards and retention controls; more complexity than explicit
  caller-owned immutable context.
- Replaying only the quiet suffix, dropping exhausted/spent history, reducing
  search limits or relaxing chase rules is incorrect or expressly out of scope.

Approval acceptance criteria for the optimization:

- Full wrapper versus context versus private Core differential parity through
  capture/FLIP/exhaustion/support/reuse/terminal outcomes and hidden permutations.
- Invalid/tampered roots rejected; context inputs immutable, branch isolation,
  no private identity/seed exposure, no stale or cross-prefix reuse.
- Fixed input/seed gives identical decisions and search coverage to correct
  full-replay v3; count every projected action identically.
- Repeat the exact saved workloads and report old / full-replay v3 / context v3
  latency and context construction cost. Then measure real browser Workers.
- Complete all remaining migration/regression checks before browser promotion.

**Requested next approval:** authorize this public-only immutable derived-context
API and the narrow EV/Tactical call-site integration. Core-only revision creation,
pin update, fresh official tournaments, commits, pushes and deployment remain
separate approval boundaries. The unchanged guard currently correctly rejects the
dirty Core, so no official new-Core tournament has been run.

## Intentional conservative limitations retained

Support must be another piece's accepted quiet move, used on the next own action.
Direct helper threats must be nonreciprocal. Refuge sets must strictly shrink;
safe-square swaps, escaping counterattacks not unconditionally chase-permitted,
screen-only discovered attacks, capture/FLIP assistance, delayed combinations and
renewals occupying the helper's old square do not earn this exception. A previously
spent helper/destination motif can be strategically useful later and still barred.
Captures and helper waiting actions remain legal according to their own rules.
No material advantage or certificate is treated as proof of a forced win.
