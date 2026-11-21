# Intel E2b 2×2 engineering pilot, seed 94001

Use the clean source checkout at `53a54110bb4aa791cc2ee5819e6d8c6fa163bb75`. Run from its root:

```sh
PYTHONPATH="$PWD" "$PY" -B /path/to/engineering-pilots/e2b-board-intel-seed-94001-100k/verify.py
```

The verifier checks the published SHA-256 values, exact public encodings and legal masks, and probability/value error at 1e-5. Portable arrays come from the Intel final policies and exclude optimizer state. The original checkpoint and training manifest digests are in engineering-summary.json. This is fixed-vector inference only. Save stdout as M1 verification evidence.
