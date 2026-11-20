"""Run the shared 4A supervisor with an Intel-local artifact directory."""
import os
import sys

from scripts.ai7.runtime import ROOT
from .campaign import main

if __name__ == "__main__":
    arguments = sys.argv[1:]
    if arguments and arguments[0] in {"prepare", "run"} and not any(
        value == "--output" or value.startswith("--output=") for value in arguments[1:]
    ):
        output = os.environ.get("AI7_INTEL_4A_OUTPUT") or (
            ROOT / "benchmark-results/ai7-selfplay/campaign4a-intel"
        )
        arguments.extend(["--output", str(output)])
    main(arguments)
