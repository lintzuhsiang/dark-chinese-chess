# Campaign 4A — GAE × value-head training

The shared trainer uses the baseline MLP and standard PPO. Each treatment uses
training seeds 7011, 7023 and 7037 and exactly 3,640,000 environment transitions
per seed, for 12 runs and 43,680,000 transitions. Initial and 910,000-transition
milestones are retained. Playing-strength comparisons use the fixed final model.

| Treatment | GAE λ | Extra Critic |
| --------- | ----- | ------------ |
| A0        | .95   | Off          |
| A1        | .95   | On           |
| A2        | .80   | Off          |
| A3        | .80   | On           |

Extra Critic runs after standard PPO. It uses the same rollout's frozen
pre-PPO GAE returns and features from the updated, frozen trunk. Two passes in
fixed rollout order update the linear value head. Adam uses LR 3e-4, epsilon
1e-5, betas .9/.999, minibatch 256, loss .5 × MSE and gradient clipping .5.
The optimizer is separately checkpointed inside the standard optimizer envelope.
If an update is interrupted, training restores the model, both optimizers and
RNG states to the update boundary.

The primary contrast from the original 21M preregistration is A1−A0 in score
against frozen Intel GAE095 seed6011. Secondary analyses separate the other
factorial contrasts, W/D/L, NO_PROGRESS, and each opponent, including Uniform
Random and Historical4023. Paired deck intervals average the two seats for each
deck first. Training-seed intervals use three independent seed effects.

## Running a new campaign

Use a common source revision on both devices and a fresh campaign directory
under `benchmark-results/ai7-selfplay`. The Node version must meet the repository
requirements, and Python needs NumPy, Torch and Matplotlib.

1. Run the bounded correctness pilot. It compares A0 with the original GAE095
   trainer and checks exact resume for A1, A2 and A3. Its verification file
   pins the training source. The three other tests are synthetic and require
   no game data.

   ```sh
   python -B -m unittest scripts.ai7_4a.tests.CorrectnessTests -v
   ```

2. Pass the pilot's `verification.json` and an explicitly selected shared
   evaluation manifest to the training supervisor. Preparation copies the
   manifest and records its hash. The supervisor runs one trainer at a time.
   Re-running it in the same campaign directory resumes eligible jobs.

   ```sh
   python -B -m scripts.ai7_4a.campaign prepare --output "$RUN" --pilot "$PILOT" --manifest "$MANIFEST"
   python -B -m scripts.ai7_4a.campaign run --output "$RUN"
   ```

3. Authorize and freeze final evaluation separately with both machines. Use the
   agreed evaluator and record checkpoint, opponent, runtime and manifest hashes.
   For this design, supply 256 distinct decks with both seats, temperature-1
   masked categorical sampling, the frozen opponents and scoring 1/.5/0. The
   established evaluator uses actor seed `deck_seed ^ 0x13579` and opponent seed
   `actor_seed ^ 0x5A5A5A5A`. The completed 21M test is already exposed.

4. Generate a report from existing outputs, using a fresh report directory.
   `--games-dir` accepts the original joint 21M per-match JSON layout.

   ```sh
   python -B -m scripts.ai7_4a.report --campaign "$RUN" --games-dir "$GAMES" --output "$REPORT"
   ```

The Intel branch source archive at `a644eea` preserves the original combined supervisor,
22M calibration implementation and joint 21M evaluator for reproducibility.
The portable supervisor ends after training and reporting on available results.
