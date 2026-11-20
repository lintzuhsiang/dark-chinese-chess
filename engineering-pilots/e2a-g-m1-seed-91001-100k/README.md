# E2a-G M1 engineering pilot

The E2a-G implementation completed 100,000 training transitions on M1, seed 91001. The producer resumed at an optimizer boundary and verified the resulting final checkpoint. This directory contains an engineering record and the producer's frozen-inference verification on 80 previously explored public observations. No official evaluation games belong to this record.

The exact execution source is preserved as commit `10275a68cfffd3f943acda028a4d0ca4ffbb0a10` in the history of `experiment/selfplay-zero`. See `docs/ai7-e2a-g-pilot.md` on that branch for the verification command and reproduction settings. Obtain the verification ZIP from the M1 producer and check it against `bundle_sha256` in `pilot.json`.

The second machine appends an independent JSON result beneath `peer-verifications/`. Compare each result's source commit, checkpoint SHA, bundle SHA, input coverage and tolerance to `pilot.json`. The M1 result currently establishes fixture reproducibility on the producer. A second-device result is pending.

`engineering-pilots/` is a Git-readable pilot area. The existing `results/` schema continues to store completed per-game study runs and dataset usage.
