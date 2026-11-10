# Dark Chess — Phase 2 AI Opponent Plan

**Version:** 0.1  
**Status:** Draft — Pending Codex Architecture Review  
**Prerequisite:** Stable Phase 1 Game Core  
**Primary Goal:** Build measurable, explainable AI opponents for Chinese Dark Chess.

---

## 1. Project Objectives

Develop AI opponents that can play Chinese Dark Chess using only information available to a human player.

The project should emphasize:

1. Correctness and fair information access.
2. Explainable decision-making.
3. Incremental algorithm development.
4. Quantitative AI evaluation.
5. Efficient browser-side execution.
6. Reuse of the existing Game Core.

### Initial Algorithms

- Random Agent
- Heuristic Agent
- One-step Expected Value Agent

### Research Extensions

- Sampled-state Simulation
- Monte Carlo Search
- Information-Set MCTS
- Self-play and learning methods

Research extensions are not part of the initial Phase 2 acceptance criteria.

## 2. Approved Architecture Direction

### Decision A — Browser-first AI

Initial AI decision-making runs locally in the browser, using Web Workers for computationally expensive operations.

Reasons:

- No AI server operating cost
- Offline-capable gameplay
- Low network dependency
- Direct reuse of TypeScript Game Core
- Simple deployment and experimentation

Do not implement a remote AI service until benchmarks demonstrate a need.

### Decision B — Observation-only Policy

AI policies must not receive the actual identities of hidden pieces.

The AI receives:

- Player-visible board
- Public game information
- Legal actions
- Relevant public history and rule context
- Decision budget
- Optional deterministic random seed

The authoritative Game Session retains the actual Full GameState.

The AI returns an action proposal. Game Core performs final validation.

### Decision C — Evaluation-first Development

Build a reproducible Evaluation Harness before developing advanced AI strategies.

Every major strategy improvement should be evaluated against an established baseline.

## 3. AI Contracts

Proposed interface, subject to review against the actual Game Core:

```ts
interface AgentInput {
  observation: PlayerObservation;
  legalActions: GameAction[];
  publicHistory: PublicGameEvent[];
  perspective: PlayerId;
}

interface DecisionOptions {
  timeBudgetMs?: number;
  seed?: number;
}

interface GameAgent {
  chooseAction(
    input: AgentInput,
    options: DecisionOptions
  ): Promise<GameAction>;
}
```

### Contract Requirements

- No actual hidden piece identities enter the Agent input.
- The legal-action list must not indirectly leak hidden identities.
- The Agent must not mutate the authoritative GameState.
- The Agent must return an action from the currently legal action set.
- Final action validation remains in Game Core.
- Stale AI decisions must not affect a restarted or updated game.
- Public rule context must be sufficient to handle applicable legality restrictions.
- During the first flip, the Agent must support a player whose color is not yet assigned.

The implementation should reuse existing project types whenever possible instead of duplicating domain models.

## 4. AI Evaluation Architecture

Separate two concerns:

### A. State Evaluation

Given a public game observation, estimate how favorable the situation is for a particular player.

### B. Action Evaluation

Given a legal action, estimate how favorable the resulting situation or possible outcomes would be.

These are related but should not be conflated.

## 5. Heuristic Features

The initial design uses five evaluation components and hidden-piece probabilities.

### 5.1 Material

Evaluate:

- Remaining pieces by color and rank
- Material lost through captures
- Relative material advantage
- Piece-specific value

Important:

- Hidden pieces still exist and must not be treated as captured.
- Revealing a piece does not create new material.
- A revealed piece's usability belongs primarily to mobility, positioning, and threat features.
- Use experimental piece values, not assumed optimal values.

### 5.2 Threat and Safety

Evaluate:

- Immediate capture threats against revealed pieces
- Opportunities to capture enemy pieces
- Exposure of valuable pieces
- Side-to-move advantage
- Potential escape or recapture

Initial implementation should focus on immediate tactical threats, rather than deep multi-turn search.

Threat analysis must respect Cannon rules and General/Soldier exceptions.

### 5.3 Relative Position

Evaluate spatial relationships between revealed friendly and enemy pieces.

Potential features:

- Distance to valuable enemy pieces
- Distance from dangerous opponents
- Target accessibility
- Friendly-piece support
- Relative attacking and defensive positioning

Begin with simple distance and accessibility measures.

Do not introduce expensive graph searches without evidence of benefit.

### 5.4 Mobility

Evaluate the movement options of revealed pieces.

Potential features:

- Number of legal non-flip movement actions
- Capture opportunities
- Restricted or trapped pieces
- Safe available destinations

Important:

- Do not count all available flips as ordinary piece mobility.
- Do not use hidden piece identities to calculate mobility.
- Evaluation of both sides should respect observable geometry and rule restrictions.

### 5.5 Board Geometry

Evaluate structural properties of the public board.

Potential features:

- Occupied and blocked neighboring cells
- Open movement corridors
- Cannon screen positions
- Board edge and corner constraints
- Hidden-piece density
- Escape routes
- Spatial connectivity

Key domain observation:

Hidden pieces obstruct ordinary movement but can serve as Cannon screens.

Geometry should capture structural potential without duplicating all immediate-threat scoring.

### 5.6 Hidden-piece Probability

Use the publicly known initial piece distribution and public capture/reveal information to derive the remaining hidden-piece multiset.

For a uniformly shuffled initial board without additional private information:

`P(piece type t at a particular hidden square) = remainingCount(t) / totalHiddenCount`

Requirements:

- Counts must reflect revealed and captured pieces.
- Probabilities across mutually exclusive outcomes sum to one.
- No actual hidden identities may influence probabilities.
- Sampling or enumeration must never exceed the remaining piece counts.
- Future probability models require separate justification.

Probability is primarily used to weight hypothetical action outcomes, not as another arbitrary term in the static evaluation sum.

## 6. Evaluation Function

Proposed scoring structure:

```text
V(observation, perspective)
  = wM × Material
  + wT × Threat
  + wR × RelativePosition
  + wL × Mobility
  + wG × Geometry
```

Each feature should also be available as a diagnostic breakdown.

### Engineering Constraints

- Use pure, independently testable evaluation functions.
- Avoid double-counting features.
- Ensure comparable score scales.
- Define scores consistently from the acting Agent's perspective.
- Keep weight configuration explicit.
- Do not assume initial weights are optimal.
- Evaluate meaningful changes with an ablation experiment.

The public evaluation function must not require actual hidden identities.

## 7. Action Scoring

### MOVE / Capture

For a known legal move:

1. Evaluate the resulting public position.
2. Account for captured material.
3. Account for immediate tactical changes.
4. Compare the resulting score with alternative actions.

A public-state transition helper may be used where appropriate. Do not feed the real FullGameState into the AI policy.

### FLIP — One-step Expected Value

For each possible revealed piece type:

1. Determine its probability from the remaining hidden-piece distribution.
2. Construct the hypothetical public observation after that reveal.
3. Evaluate the resulting situation.
4. Weight the result by the probability.
5. Sum the outcomes.

Conceptually:

```text
Q(FLIP(x))
  = Σ P(piece=t | public information)
      × V(observation after revealing t at x)
```

The evaluated position must account for the next player's turn and any initial color assignment.

MOVE and FLIP scores must use compatible scales.

This is a one-step expected-value approach, not a multi-turn Monte Carlo search.

## 8. Evaluation Harness

Build a headless tournament runner that can execute in Node.js without React.

### Core Features

- AI versus AI games
- Deterministic game initialization
- Controlled random seeds
- Paired games with first-player positions exchanged
- Game result recording
- Decision timing
- Illegal-action and timeout detection
- JSON or CSV output

### Metrics

**Playing strength**
- Win rate
- Draw rate
- Average score: win = 1, draw = 0.5, loss = 0
- Confidence intervals
- Optional relative rating system when enough results exist

**Performance**
- Decision latency p50/p95
- Decision time budget
- Search or evaluation operations per decision, when applicable
- Memory usage when measurable

**Reliability**
- Illegal-action rate
- Unhandled errors
- Timeouts
- Stale decision handling
- Reproducibility
- Hidden-information independence

### Experimental Principles

- Use the same game rules for all Agents.
- Use controlled openings and random seeds.
- Exchange first-player assignments.
- Report sample sizes and statistical uncertainty.
- Keep benchmark data separate from implementation tests.
- Avoid declaring an AI stronger based on a handful of games.

## 9. Implementation Tasks

### AI-0 — Architecture Review and Contract Alignment

**Goal:** Establish the Phase 2 implementation boundary.

Work:

- Inspect existing Game Core, observations, actions, results, and timeline.
- Verify that legal actions can be supplied without leaking hidden identities.
- Review the first-flip and perpetual-chase implications.
- Identify the minimum Agent input contract.
- Determine which existing APIs can be reused.
- Review Browser Worker requirements.

**Acceptance:**
- Agreed Agent interface
- Clear trust boundary
- Identified contract gaps
- No speculative backend or simulation framework

**Verification:** Architecture review and concrete example scenarios.

### AI-1 — Random Agent and Basic Agent Integration

**Goal:** Build the simplest correct AI opponent.

Work:

- Implement the approved Agent interface.
- Create a deterministic seeded Random Agent.
- Select only from legal actions.
- Integrate the Agent with a minimal headless game loop.
- Ensure stale decisions cannot alter another game session.

**Acceptance:**
- Agent completes legal games.
- No invalid actions.
- Same state and random seed reproduce the same decision sequence.
- Hidden-state permutations do not affect decisions.
- No UI or backend dependency in the policy.

**Verification:** Unit tests, deterministic fixtures, full headless games.

### AI-2 — Tournament and Evaluation Harness

**Goal:** Create an evidence-based comparison environment.

Work:

- Implement a headless match runner.
- Support paired randomized openings.
- Collect game results, decision times, errors, and reproducibility metadata.
- Export simple machine-readable results.
- Establish baseline measurements using Random Agents.

**Acceptance:**
- Repeatable benchmark results under fixed conditions.
- Correct win/draw/loss accounting.
- Fair assignment of first-player positions.
- Clear distinction between actual results and estimates.
- No React or browser requirement.

**Verification:** Seeded tournaments, independent metric tests, replay consistency.

### AI-3 — Heuristic Evaluation Engine

**Goal:** Evaluate observable positions using domain-informed features.

Work:

- Implement Material.
- Implement Immediate Threat/Safety.
- Implement Relative Position.
- Implement Mobility.
- Implement Geometry.
- Provide feature-by-feature score breakdown.
- Implement a Heuristic Agent for known legal moves and captures.

**Acceptance:**
- All evaluations operate on public information.
- Core tactical scenarios produce sensible feature scores.
- Evaluation handles both player colors.
- No hidden-state dependency.
- Feature scales and initial weights are documented.

**Verification:** Table-driven evaluation tests, symmetry tests, tactical fixtures, and first tournament comparison.

### AI-4 — Expected Value for Flipping

**Goal:** Add probabilistic evaluation of hidden-piece reveals.

Work:

- Derive remaining hidden-piece counts.
- Calculate probabilities of possible reveals.
- Evaluate hypothetical post-flip public observations.
- Combine results into expected scores.
- Compare MOVE and FLIP decisions on a consistent scale.
- Handle first-flip color assignment correctly.

**Acceptance:**
- Correct conditional probabilities.
- No actual hidden-identity access.
- Correct handling of all remaining-piece distributions.
- Deterministic decisions for identical inputs and seeds.
- Explainable evaluation output.

**Verification:** Probability tests, flip examples, hidden-identity permutation tests, and tournament comparisons.

### AI-5 — Browser Web Worker and Product Integration

**Goal:** Allow users to play against AI on phones and desktops.

Work:

- Add Human vs AI mode.
- Execute AI decision-making in a Web Worker where appropriate.
- Connect decisions to the authoritative Game Session.
- Handle AI computation cancellation, timeouts, and stale responses.
- Introduce simple difficulty settings based on validated strategies or budgets.

**Acceptance:**
- Users can complete a game against AI.
- Game UI remains responsive during AI computation.
- Restart and state changes invalidate stale decisions.
- All actions are revalidated.
- No backend is required.
- Existing minimalist UX principles remain intact.

**Verification:** Browser integration tests, mobile smoke tests, decision latency measurements.

### AI-6 — Strategy Evaluation and Optimization

**Goal:** Determine whether the added algorithm complexity produces measurable value.

Work:

- Compare Random, Heuristic, and Expected Value Agents.
- Run paired tournaments.
- Measure accuracy, performance, and reliability.
- Perform ablation studies on heuristic components.
- Test multiple decision budgets and device classes.
- Identify weaknesses and propose targeted improvements.

**Acceptance:**
- Reproducible evaluation report.
- Explicit sample sizes and confidence intervals.
- Strength/performance comparison.
- Documented limitations.
- Evidence-based recommendation for the next algorithm.

**Verification:** Benchmark runs, statistical summaries, regression checks, and review of experiment setup.

## 10. Task Dependencies

Recommended implementation order:

`AI-0 → AI-1 → AI-2 → AI-3 → AI-4 → AI-5 → AI-6`

After contracts are established, selected evaluation and UI preparation activities may be parallelized.

Do not develop several incompatible Agent APIs independently.

## 11. Multi-Agent Development Strategy

Suggested roles:

- **Main Agent:** Architecture ownership, delegation, integration, acceptance
- **Game AI Engineer:** Agent policies, evaluation functions, algorithm implementation
- **Evaluation Engineer:** Tournament Harness, metrics, reproducibility
- **Independent QA:** Information leakage, correctness, edge cases, evaluation integrity

Parallel development requires stable shared contracts and non-overlapping file ownership.

Independent QA should challenge the evaluation methodology, not only implementation correctness.

## 12. Research Extension — Hypothetical GameState Simulation

This section records our previous design discussion. It is not part of the initial implementation scope.

### Approach A — Current Preferred Baseline

Use public observations and one-step expected-value evaluation.

Advantages:
- Simpler
- Explainable
- Relatively inexpensive
- No complete hidden-board sampling needed
- Easier to test information isolation

### Approach B — Future Research

Generate hypothetical complete GameStates consistent with public information.

A simulation engine may use complete hypothetical states to execute future game transitions.

However:

- The actual hidden board must never be provided to the sampling algorithm.
- Samples must respect remaining-piece counts.
- Revealed and captured pieces must remain consistent.
- Simulated policies must receive only their simulated public observations.
- Simulation rules and histories must remain coherent.
- Determinization may cause strategy-fusion bias.

Potential future experiments:

1. Uniform hidden-state sampling
2. Monte Carlo rollouts
3. Search-budget comparison
4. Determinization versus Information-Set Search
5. MCTS with evaluation-function guidance

Do not create simulation infrastructure before benchmarks justify it.

## 13. Open Architecture Decisions for Codex Review

1. Does the existing Game Core expose enough public information for AI?
2. What is the minimal representation of public rule context?
3. Does the simplified perpetual-chase rule require additional AI-visible tracking?
4. How should the first flip be evaluated before colors are assigned?
5. Can public action transitions reuse existing logic without relying on actual hidden identities?
6. What is the simplest headless Evaluation Harness?
7. Should Web Worker integration occur before or after heuristic benchmarking?
8. Which heuristic features overlap or risk double-counting?
9. How should feature scales and initial weights be selected?
10. Which tasks can run safely in parallel?
11. What would justify switching to Backend AI?
12. What evidence should trigger research into sampled simulation or MCTS?

## 14. Phase 2 Definition of Done

- [ ] Human vs AI gameplay works.
- [ ] AI policies use only public information.
- [ ] Random Agent establishes a reproducible baseline.
- [ ] Heuristic Agent is implemented and tested.
- [ ] Expected Value supports probabilistic flips.
- [ ] Evaluation Harness produces reproducible reports.
- [ ] Illegal actions and hidden-information leakage tests pass.
- [ ] Browser responsiveness and decision latency are measured.
- [ ] At least one strategy comparison and ablation study is documented.
- [ ] Known limitations and potential research extensions are recorded.

**Phase 2 success is not defined by claiming the AI is strong. It is defined by creating a reliable AI opponent and demonstrating measurable, reproducible improvements or limitations.**