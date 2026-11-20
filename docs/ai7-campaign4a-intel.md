# Intel Campaign 4A launcher and source archive

Use the shared [4A design and trainer](ai7-campaign4a.md). On Intel macOS, use
Python 3.11 with the pins in `scripts/ai7/requirements-intel.txt` and a
repository-supported Node release.

```sh
.venv-intel/bin/python -B -m scripts.ai7_4a.intel_launch prepare --manifest "$MANIFEST" --pilot "$PILOT"
.venv-intel/bin/python -B -m scripts.ai7_4a.intel_launch run
```

The wrapper uses `benchmark-results/ai7-selfplay/campaign4a-intel`. Set
`AI7_INTEL_4A_OUTPUT` or pass `--output` to choose a different directory.
The original `gae-critic-factorial-20261115` artifact tree is the completed
historical campaign. Use the shared report reader for its existing results.

The archive commit `a644eea` preserves all eight original 4A files, including
the original supervisor and `scripts/ai7_4a/joint21.py`. Their SHA-256 values
match the original training config and joint-evaluation preregistration.
Use the original campaign's `source-snapshot` and recorded runtime hashes for
historical reproduction. The parent of the archive commit is the production
branch base for this split.

`scripts.ai7_4a.reference` contains the Intel-specific historical bundle
exporter and artifact locations. It reads the original checkpoints from Intel
artifact storage, so the code branch can be shared without copying model files.
