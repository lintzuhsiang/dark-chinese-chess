# AI-1 headless runner

AI-0 is finalized in [the Phase 2 plan](../../docs/phase-2-ai-plan.md).
Core is pinned to 34452df2bc198d382e36399218d2cfcb9e95f3f3. The source runner
checks Core/rules against that commit before starting or verifying a replay.
It requires this Git checkout and the existing Node/TypeScript test toolchain.

## Entry points

- createMatchRunner: trusted, incremental request/commit boundary and same-deck restart.
- runMatch: sequential complete game, accepted prefix on Agent failure, or explicit ply-limit truncation.
- verifyReplay: existing reconstruction must reproduce the full state, public events, and GameResult.
- randomAgent: browser-independent bounded policy receiving only the approved public input and one seed.

Run focused verification from the repository root:

```sh
node_modules/.bin/vitest run packages/ai-agents/tests scripts/ai-eval/tests
```

No browser, React rendering, service, or separate runtime dependency is required.
The runner currently executes through the existing Node/Vitest TypeScript pipeline;
there is no packaged CLI or tournament scheduler.

## Reproducibility and trust

The host supplies independent unsigned 32-bit deckSeed and agentSeed roots.
The existing deck utility consumes its own fresh Mulberry32 stream. Decision seeds
use HMAC-SHA256 with the decimal Agent root as UTF-8 key and
JSON.stringify(["dark-chess-agent-decision-v1", playerId, plyCount]) as UTF-8 message;
interpret digest bytes 0–3 as unsigned little-endian. Each Random decision uses a
fresh Mulberry32 stream and floor(sample * permittedActionCount).

Request/generation/revision counters never affect decision randomness. Generations
are unique within this Node process; requests are single-use and supersede earlier
pending requests. Accepted actions and restart advance revision. Assignments are
fixed; create a new runner when changing Agents. Restart repeats the original deck
and roots and invalidates all previous responses.

Match reports are **trusted artifacts**: they contain the private initial deck,
final full state, root seeds, configuration labels, environment, and public history.
Only the allowlisted/frozen Agent input and decision seed enter chooseAction.
Configuration labels are caller supplied (default: unspecified); formal tournament
manifests and source-version reporting for strategies belong to AI-2.

COMPLETED uses the Core's GameResult. FAILED and TRUNCATED are administrative
execution outcomes and never become draws or losses. The default 4096-ply cap is
an administrative safeguard; callers can choose a smaller cap for verification.
Replay verifies the recorded execution prefix, not that an arbitrary policy would
choose those actions again.

Only bounded early policies are supported. There are no time budgets, hard CPU
preemption, Worker cancellation/recovery, alternate timelines, public projections,
heuristics, or tournament metrics in AI-1.
