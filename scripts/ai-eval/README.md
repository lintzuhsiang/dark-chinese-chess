# Headless matches and tournament evaluation

The [Phase 2 plan](../../docs/phase-2-ai-plan.md) records the approved boundaries.
AI-2 extends the existing AI-1 runner; it adds no strategy or game rules.
Core remains pinned to 34452df2bc198d382e36399218d2cfcb9e95f3f3. Execution and
replay verification require this Git checkout and reject a changed Core/rules.

## Benchmark command

From the repository root, using the repository-supported Node runtime (verified on Node 26.10.0):

```sh
node --import ./scripts/ai-eval/register.mjs ./scripts/ai-eval/cli.ts \
  --pairs 20 --deck-start 1543 --agent-seed 7 \
  --output benchmark-results/random-baseline.json
```

The CLI currently compares two labeled instances of RandomAgent. JSON goes to the
specified file and a compact summary goes to the terminal. Reports are ignored by
Git. No package installation, browser, React rendering, or service is needed for
this command; the small source resolver uses Node's built-in TypeScript support.

Use `--deck-seeds 10,20,30` instead of `--pairs`/`--deck-start` for explicit seeds.
Other options: `--max-plies 4096`, `--confidence 0.95`, and `--help`.
Exit status is 0 for complete, source-stable runs, 2 for retained unfinished games
or source changes, and 1 for an invalid experiment/setup error.

## Entry points

- `createMatchRunner`: trusted incremental request/commit boundary and same-deck restart.
- `runMatch`: the sole match loop; retains the accepted prefix on failure/truncation.
- `verifyReplay`: existing reconstruction reproduces full state, public events, and GameResult.
- `runTournament`: pairs, seat swaps, source manifest, and aggregate reporting.
- `summarizeTournament`: independently testable result and performance accounting.
- `randomAgent`: bounded policy receiving only approved public input and one seed.

The typed tournament API accepts two descriptors containing an ID, implementation
version, JSON configuration, source file paths, and the existing GameAgent policy.
IDs must differ; implementations may be the same. Source paths must be regular
files inside this checkout. Policies must be deterministic from public input/seed
and stateless between matches; descriptors do not configure policies implicitly.

## Scheduling and randomness

Each distinct uint32 deck seed defines one pair:

1. A is P1 and B is P2.
2. B is P1 and A is P2, with the identical shuffled initial deck.

The experiment's Agent root is independent of deck seeds. A pair root is derived
using HMAC-SHA256 with decimal Agent root as UTF-8 key and
`JSON.stringify(["dark-chess-pair-agent-v1", pairIndex])` as UTF-8 message;
digest bytes 0–3 are unsigned little-endian (`hmac-sha256-pair-u32le-v1`).
Both legs share this root, giving common seat-level randomness. Decision seeds
retain AI-1's HMAC message
`JSON.stringify(["dark-chess-agent-decision-v1", playerId, plyCount])`.
Each policy decision uses a fresh Mulberry32 stream and
`floor(sample * permittedActionCount)`. Shuffling uses a separate fresh Mulberry32
stream and the existing Fisher–Yates deck utility. Request/generation/revision
counters never affect these streams. Neither root nor deck data enters AgentInput.

Duplicate deck seeds are rejected: repeated openings would require a separate
clustering policy. Seed array order and pair index are part of the manifest.

## Results, errors, and measurement

A completed game's winner comes from GameResult, never terminal currentPlayer.
W/D/L and average score (1/0.5/0) use completed games, with their denominator explicit.
Every attempted leg remains in JSON, including accepted transcript, public events,
final state, length, seat assignment, seeds, decision samples, and failure details.
Setup failures before a runner exists have a null match report and an explicit error.

Invalid actions, Agent exceptions, runner/Core invariant errors, and administrative
ply-limit truncations are distinct categories. None becomes a domain draw/loss.
The default 4096-ply cap is administrative. Failed and truncated games are unscored;
one complete leg still contributes to completed-game accounting, but its incomplete
pair does not contribute to paired inference. Mean game length includes all attempted
prefixes, including zero-length setup failures.

Decision latency starts after public input and seed preparation and stops immediately
after the Agent Promise settles, before validation/commit. It includes synchronous
policy work, Promise settlement, and event-loop delay; it is not CPU-only timing.
p50/p95 use nearest rank (`ceil(p*n)-1`) across all sampled decisions, including errors.
Zero samples produce null percentiles. Counts distinguish illegal actions, Agent
exceptions, and runner failures. There are no decision-time budgets; budget overruns
are null/not applicable. Latency varies across runs, hardware, and concurrent load.

## Statistical uncertainty

For each complete pair, let `x = (scoreA_leg0 + scoreA_leg1) / 2` in [0,1].
Each pair is one observation. The report gives the pair mean and a conservative
Hoeffding confidence interval, clipped to [0,1]:

```text
alpha = 1 - confidenceLevel
radius = sqrt(log(2 / alpha) / (2 * completedPairs))
```

With zero complete pairs the mean/interval are null; one pair gives [0,1] at 95%.
The procedure uses no random resampling and needs no CI seed. It never treats the
two legs as independent observations. The completed-game mean and complete-pair
mean have separate denominators and can differ when legs are incomplete.

Coverage assumes independent, representative pair draws. Distinct deterministic
seeds alone do not prove that assumption; the supplied seed schedule defines the
experiment, not a claim about all openings. Excluding incomplete pairs may bias
strength estimates if failures depend on strategy. Always inspect failure rates
and completion coverage before interpreting the interval or claiming improvement.

## Source identity and trusted artifacts

The manifest records Core pin, HEAD/branch, full Git dirty/clean status, Agent IDs,
configurations/source hashes, runner identity, seed schedules/versions, limits, and
runtime/OS/CPU metadata. Selected runtime/configuration sources are hashed; dirty
tracked changes include a binary Git patch against HEAD, including deletions, and
untracked source bytes are embedded as base64 with matching hashes. Restoring HEAD
plus this archive identifies the selected source snapshot rather than a hash-only
claim about uncommitted code. Custom Agents must declare any implementation files
outside the standard captured roots, including their local dependencies.

The harness checks source hashes and HEAD again after execution. If they changed,
`sourceStableDuringRun` is false and the report does not claim one reproducible
executed version. Use a stable checkout while running. This archive is not a
hermetic environment image or protection against undeclared external side effects.
Actions, results, and scoring should reproduce for the same identified versions,
configuration, and seeds; timings need not reproduce.

Reports are trusted offline artifacts containing private decks, full final states,
and root seeds. Policies receive only the detached/frozen public prefix and a decision
seed. Configuration/provenance is captured before awaited decisions. Generations
remain process-local; accepted actions/restart advance revision, and stale, duplicate,
or mismatched proposals cannot commit.

## Verification and scope

```sh
node_modules/.bin/vitest run packages/ai-agents/tests scripts/ai-eval/tests
```

AI-2 adds no heuristics, expected-value projection, search, Elo, UI, backend, database,
or dashboard. Hard CPU timeouts, Worker/process isolation, cancellation, and supervision
are not implemented; only bounded policies are supported. A policy that never settles
cannot be forcibly interrupted by this harness. AI-3 has not started.
