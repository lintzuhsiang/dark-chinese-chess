"""Run from the pinned source checkout with this directory on disk."""
import hashlib,json,platform,subprocess,sys
from pathlib import Path
import numpy as np
import torch
from scripts.ai7.runtime import encode,mask_array,make_policy,seed_all,CORE_REVISION
p=Path(__file__).resolve().parent
for line in (p/"SHA256SUMS").read_text().splitlines():
    sha,name=line.split("  ",1)
    assert hashlib.sha256((p/name).read_bytes()).hexdigest()==sha,name
s=json.loads((p/"engineering-summary.json").read_text())
assert subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()==s["runtime"]["git_commit"]
assert not subprocess.check_output(["git","status","--porcelain","--untracked-files=no"])
assert CORE_REVISION==s["runtime"]["core_revision"]
obs=json.loads((p/"observations.json").read_text())
x=np.stack([encode(o) for o in obs]); m=mask_array(obs)
seed_all(94001,2)
results=[]
for row in s["arms"]:
    a=row["architecture"]
    model=make_policy({"architecture":a}).eval()
    with np.load(p/(a+"-weights.npz"),allow_pickle=False) as weights:
        model.load_state_dict({k:torch.from_numpy(weights[k]) for k in weights.files},strict=True)
    with np.load(p/(a+"-references.npz"),allow_pickle=False) as ref, torch.inference_mode():
        assert np.array_equal(x,ref["features"]) and np.array_equal(m,ref["masks"])
        d,v=model(torch.from_numpy(x),torch.from_numpy(m))
        assert not d.probs.numpy()[~m].any()
        errors={k:float(np.max(np.abs(got-ref[k]))) for k,got in {"probabilities":d.probs.numpy(),"values":v.numpy()}.items()}
        assert all(e<=1e-5 for e in errors.values()),(a,errors)
    results.append({"architecture":a,"observations":len(m),"mask_mismatches":0,"max_abs_errors":errors})
print(json.dumps({"status":"PASS","machine":platform.machine(),"python":sys.version.split()[0],"numpy":np.__version__,"torch":str(torch.__version__),"results":results},indent=2))
