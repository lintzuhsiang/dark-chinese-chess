"""Export original Intel training evidence and proposed Campaign 4 protocol."""
import ast
import gzip
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

import numpy as np
import torch

from scripts.ai7.shared_protocol import ROOT, audit_seeds, sha256, source_evidence, write_new
from scripts.ai7.runtime import load_checkpoint, encode, mask_array

CAMPAIGN = ROOT / 'benchmark-results/ai7-selfplay/gae-critic-factorial-20261115'
OLD = ROOT / 'benchmark-results/ai7-selfplay/intel-learning/20261115-v1'
P0 = ROOT / 'benchmark-results/ai7-selfplay/intel-p0/20261115-v1'


def make():
    export = ROOT / 'benchmark-results/ai7-selfplay/exports/intel-gae095-training-reference-v1'
    export.mkdir(parents=True, exist_ok=False)
    package = export / 'intel-gae095-training-reference-v1'
    package.mkdir()
    run = OLD / 'runs/gae_lambda_095-seed-6011'
    evidence = json.loads((OLD/'intel-source-evidence.json').read_text())
    manifest = json.loads((run/'manifest.json').read_text())
    origins = {}
    for name, expected in evidence['source_hashes'].items():
        original = OLD/'source-snapshot'/name
        target = package/'source'/name
        target.parent.mkdir(parents=True, exist_ok=True)
        if original.is_file():
            assert sha256(original) == expected, name
            shutil.copyfile(original, target)
            origins[name] = 'original_intel_campaign_source_snapshot'
        else:
            target.write_bytes(subprocess.check_output(['git','show',evidence['git_commit']+':'+name],cwd=ROOT))
            origins[name] = 'recorded_commit_object_verified_against_original_campaign_hash'
        assert sha256(target) == expected, name
    for src, name in [(run/'manifest.json','original-run-manifest.json'),(run/'summary.json','original-run-summary.json'),
                      (OLD/'intel-source-evidence.json','original-training-source-evidence.json')]:
        shutil.copyfile(src, package/name)
    write_new(package/'original-run-config.json',manifest['config'])
    write_new(package/'source-origins.json',origins)
    model, checkpoint = load_checkpoint(run/'final.pt')
    assert checkpoint['config']['seed']==6011 and checkpoint['env_steps']==3640000
    assert checkpoint['config']['gae_lambda']==.95 and checkpoint['config']['chain_alpha']==0
    expected = next(r['sha256'] for r in json.loads((OLD/'checkpoint-index.json').read_text())
                    if r['treatment']=='gae_lambda_095' and r['training_seed']==6011 and r['endpoint']=='final')
    assert sha256(run/'final.pt')==expected
    frozen = package/'frozen-opponent'; frozen.mkdir()
    shutil.copyfile(run/'final.pt',frozen/'gae095-seed6011-final.pt')
    np.savez_compressed(frozen/'weights.npz',**{k:v.numpy() for k,v in model.state_dict().items()})
    tensors={k:{'shape':list(v.shape),'dtype':str(v.numpy().dtype),
                'sha256_float32':__import__('hashlib').sha256(v.numpy().astype('<f4').tobytes()).hexdigest()}
             for k,v in model.state_dict().items()}
    write_new(frozen/'tensor-schema.json',tensors)
    opponent={'name':'intel_gae095_seed6011','checkpoint_sha256':expected,'checkpoint_bytes':(run/'final.pt').stat().st_size,
              'selection':'predetermined training seed identity 6011, never evaluation performance',
              'model_config':checkpoint['model_config'],'architecture':checkpoint['architecture'],
              'observation_version':checkpoint['observation_version'],'core_revision':checkpoint['core_revision'],
              'env_steps':checkpoint['env_steps'],'training_config':checkpoint['config'],
              'loading':'runtime.load_checkpoint(path, cpu); eval; no optimizer step; strict state_dict; trusted owner artifact only',
              'npz_sha256':sha256(frozen/'weights.npz'),'source_model':'source/scripts/ai7/runtime.py',
              'action_encoding':{'count':1056,'flip':'position','move':'32 + from*32 + to'},
              'sampling':{'temperature':1,'policy':'stochastic masked categorical','numpy':'PCG64 via default_rng',
                          'action_seed':'deck_seed XOR 0x13579','opponent_stream':'action_seed XOR 0x5A5A5A5A',
                          'normalization':'ordered legal ids; probabilities float32 then float64 legal renormalization; choice'},
              'compatibility':'Core, action bytes, encode and Policy definitions verified below; dependency/platform mismatches remain explicit'}
    write_new(frozen/'metadata.json',opponent)
    # Compare function definitions as well as current hashes: names alone are insufficient.
    old=(package/'source/scripts/ai7/runtime.py').read_text(); current=(ROOT/'scripts/ai7/runtime.py').read_text()
    def function(src,name):
        return ast.get_source_segment(src,next(n for n in ast.parse(src).body if getattr(n,'name',None)==name))
    compatible={name:function(old,name)==function(current,name) for name in ['Policy','encode','mask_array','advantages','load_checkpoint']}
    assert all(compatible.values())
    for name in evidence['components']['game_core']['files']+evidence['components']['action_encoding']['files']:
        assert sha256(ROOT/name)==evidence['source_hashes'][name],name
    write_new(package/'source-compatibility.json',{'definitions_identical':compatible,
              'Core_and_action_files_identical':True,'collect_difference':'Current M1 integration adds training-only rotation/reward features, disabled in 4A; sampling code is retained. A0 full pilot equivalence is a separate gate.',
              'current_evaluation_environment':source_evidence()['dependencies'],
              'original_training_environment':evidence['dependencies'],
              'M1_local_versions_and_conformance':'unverified_pending_M1_response'})
    # Non-game reference fixture: existing explored Stage2 observation, never reserved positions.
    row=json.loads((P0/'imports/intel-evaluation-bundle/tactical-bank/stage2.json').read_text())['bank'][0]
    observations=[row['observation'],row['rotated']]
    with torch.inference_mode():
        distribution, values=model(torch.from_numpy(np.stack([encode(o) for o in observations])),torch.from_numpy(mask_array(observations)))
    write_new(frozen/'reference-observations.json',observations)
    np.savez_compressed(frozen/'reference-predictions.npz',probabilities=distribution.probs.numpy(),values=values.numpy())
    # Audit current accessible manifests plus the prior exported M1 seed inventory.
    audit=audit_seeds(excluded=CAMPAIGN)
    assert not audit['errors']
    prior_inventory=P0/'imports/intel-evaluation-bundle/seed-inventory.json'
    if not prior_inventory.exists():
        candidates=list((P0/'imports/intel-evaluation-bundle').rglob('*inventory*.json'))
        prior_inventory=next((p for p in candidates if 'seed' in p.name),None)
    usages=audit['documented_reservations']+[r for x in audit['records'] for r in x['ranges']]
    rejected=[]; start=21000000
    while any(r['start']<=start+255 and r['end']>=start for r in usages):
        rejected.append(start); start+=1000000
    calibration_start=start+1000000
    while any(r['start']<=calibration_start+31 and r['end']>=calibration_start for r in usages):
        calibration_start+=1000000
    engines={name:sha256(ROOT/name) for name in ['scripts/ai7/runtime.py','scripts/ai7/evaluate.py','scripts/ai7/evaluate_shared.py',
             'scripts/ai7/environment.ts','scripts/ai7/server.ts','scripts/ai7_p0/common.py',
             'packages/ai-agents/src/seeded-random.ts','apps/web/src/game/deck.ts']}
    historical=P0/'imports/intel-evaluation-bundle/historical-opponent/baseline-seed-4023-step-3640000.pt'
    protocol={'protocol_id':'ai7-campaign4-common-opponents-256-v1','state':'proposed_pending_M1_inventory_confirmation',
              'deck_seeds':list(range(start,start+256)),'seats':[0,1],'games_per_model_opponent':512,
              'score':{'WIN':1,'DRAW':.5,'LOSS':0},'terminal_reasons':['NO_PIECES','NO_LEGAL_ACTION','NO_PROGRESS','CHASE_STALEMATE'],
              'opponents':[{'name':'random','implementation_sha256':engines['scripts/ai7/runtime.py'],'sampling':'uniform ordered legal action ids; opponent PCG64 stream'},
                           {'name':'m1_exp2_baseline_4023','checkpoint_sha256':sha256(historical)},opponent],
              'sampling':opponent['sampling'],'evaluator':{'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
              'source_sha256':engines,'batch_games':16,'device':'cpu','torch_threads':2,'stopping':'authoritative Core terminal; 4096-ply safety failure never a draw'},
              'seed_audit':{'local_metadata_records':len(audit['records']),'errors':audit['errors'],'rejected_starts':rejected,
                            'M1_status':'unverified; old supplied inventory audited locally, current inventory confirmation required',
                            'older_M1_inventory_sha256':sha256(prior_inventory) if prior_inventory else None},
              'prior_20M':'already used, excluded; never a fresh test',
              'calibration':{'deck_seeds':list(range(calibration_start,calibration_start+32)),
                'policy':'frozen Intel GAE095 seed6011','opponent':'m1_exp2_baseline_4023',
                'states':'up to 8 evenly spaced learner public states per completed reference game, both seats',
                'targets':'sampled terminal returns from the SAME frozen reference trajectories for ALL treatments',
                'qualification':'off-policy reference-return diagnostic, not exact V_pi or identical true ground truth'},
              'freeze_rule':'Content and SHA fixed before new final results. M1 confirmation must reference this exact SHA and inventory hash. No seed change based on results.',
              'final_evaluation_gate':'Do not start final Campaign4 games until M1 confirms no seed overlap; training does not wait.'}
    write_new(CAMPAIGN/'shared-evaluation-manifest.json',protocol)
    shutil.copyfile(CAMPAIGN/'shared-evaluation-manifest.json',package/'campaign4-proposed-manifest.json')
    write_new(package/'accessible-seed-audit.json',audit)
    write_new(package/'M1-confirmation-template.json',{'manifest_sha256':sha256(package/'campaign4-proposed-manifest.json'),
              'status':'PENDING','M1_inventory_sha256':'unverified','deck_overlap':'unverified','calibration_overlap':'unverified',
              'training_rng_seed_reuse_7011_7023_7037':'unverified','reserved_bank_opened':False,'local_conformance':'unverified'})
    (package/'M1_INSTRUCTIONS.md').write_text(INSTRUCTIONS)
    (package/'verify.py').write_text(VERIFY)
    write_new(package/'manifest.json',{'bundle_id':package.name,'original_base_commit':evidence['git_commit'],
              'training_source_files':len(origins),'training_source_sha256':evidence['source_hashes'],
              'checkpoint_sha256':expected,'campaign4_manifest_sha256':sha256(package/'campaign4-proposed-manifest.json'),
              'scope':'Original verified training source/config and ONE unchanged full checkpoint; no rollout logs, other training checkpoints or reserved bank'})
    checks={p.relative_to(package).as_posix():sha256(p) for p in sorted(package.rglob('*')) if p.is_file()}
    (package/'checksums.sha256').write_text(''.join(f'{v}  {k}\n' for k,v in checks.items()))
    archive=export/(package.name+'.tar.gz')
    with archive.open('xb') as raw, gzip.GzipFile(fileobj=raw,mode='wb',mtime=0,filename='') as gz, tarfile.open(fileobj=gz,mode='w') as tar:
        for p in sorted(package.rglob('*')):
            if not p.is_file(): continue
            info=tar.gettarinfo(str(p),arcname=str(Path(package.name)/p.relative_to(package)))
            info.uid=info.gid=info.mtime=0; info.uname=info.gname=''
            with p.open('rb') as stream: tar.addfile(info,stream)
    archive.with_suffix(archive.suffix+'.sha256').write_text(sha256(archive)+'  '+archive.name+'\n')
    print(json.dumps({'archive':str(archive),'sha256':sha256(archive),'bytes':archive.stat().st_size,
                      'checkpoint_sha256':expected,'protocol_sha256':sha256(package/'campaign4-proposed-manifest.json')},indent=2))


INSTRUCTIONS='''# M1 training reference and Campaign 4 coordination

Verify the independent archive SHA, extract, then run `shasum -a 256 -c checksums.sha256`.
Run `python3 -B verify.py` in the extracted folder using your existing M1 RL environment.
This checks every file and compares the unchanged original checkpoint/NPZ tensor
values and two already-explored public reference observations (tolerance 1e-5).
No training or complete games are run by verification.

The original source was dirty Intel work on its recorded base, not today's M1
integration branch. `source/` contains 145 exact source files checked against the
original campaign hashes, including train.py, learning_methods.py, runtime.py
(Policy and advantages), public encoder/action IDs, Core and Node bridge.
Original config, manifest, source provenance and dependencies are separate files.
Intel used Python3.11.15/Torch2.2.2/NumPy1.26.4; retain actual M1 versions and do
not install x86-specific requirements on arm64. Reproduction under different
Torch/NumPy versions is not a claim of bitwise matching trajectories.

To reproduce the original GAE095 method, create a NEW detached worktree at the
`original_base_commit` in manifest.json, then copy source/ contents preserving
relative paths into that clean independent worktree. Never overlay a running
training checkout. Do not modify frozen-opponent/gae095-seed6011-final.pt.

From the independent repository, using the established compatible Python and Node26:

    python3 -B -m scripts.ai7.train --output benchmark-results/ai7-selfplay/m1-gae095-reference-seed6011 --learning-method gae_lambda_095 --architecture baseline --seed 6011 --max-env-steps 3640000 --max-updates 100000 --until-step-target --checkpoint-every-steps 910000 --batch-games 16 --threads 2 --device cpu --validation-seed-start 1500000 --validation-pairs 16 --max-replays 4 --instrumentation basic

Use AI7_ARTIFACT_ROOT set to the absolute NEW output directory for the original
artifact budget guard. The command reproduces the historical method with its
historical seed for source validation; it is NOT a new independent replication.
Campaign 4 uses the separately preregistered fresh seeds and factorial treatments.
The old trainer cannot implement lambda .80/extra critic without the new adapter.

## Required M1 protocol response before new final evaluation

Audit campaign4-proposed-manifest.json against ALL available M1 training,
validation, curriculum-generation and evaluation seed metadata/source namespaces.
Do not open/read/hash the reserved tactical bank. Confirm the 256 deck IDs and
the distinct calibration IDs are unused; the old 20M set is already used.
Also check training RNG seeds7011/7023/7037 separately from deck seeds.
Return a completed M1-confirmation-template.json with the exact protocol SHA,
actual inventory SHA, evidence paths/ranges, local versions, overlap findings and
conformance output. Do not convert PENDING/unverified to verified without audit.
Both machines preserve the exact file bytes. Any collision must be resolved and
a revised protocol explicitly frozen BEFORE observing new final-test results.
No Campaign4 final evaluation starts until this confirmation arrives; Intel
implementation and training may proceed independently. No M1 restart is required.
The prior M1 evaluation bundle supplies the fixed Baseline4023 bytes; it is not
silently replaced by a campaign's latest model.
'''

VERIFY='''"""Read-only static/tensor/inference verification; no complete games."""
from pathlib import Path
import hashlib,json,sys
import numpy as np
import torch
root=Path(__file__).resolve().parent
for line in (root/'checksums.sha256').read_text().splitlines():
    digest,name=line.split('  ',1); p=root/name
    assert p.resolve().is_relative_to(root) and hashlib.sha256(p.read_bytes()).hexdigest()==digest,name
sys.path.insert(0,str(root/'source'))
from scripts.ai7.runtime import Policy,encode,mask_array
model=Policy(); schema=json.loads((root/'frozen-opponent/tensor-schema.json').read_text())
with np.load(root/'frozen-opponent/weights.npz',allow_pickle=False) as data:
    weights={k:torch.from_numpy(data[k].copy()) for k in schema}
for k,v in weights.items():
    assert list(v.shape)==schema[k]['shape']
    assert hashlib.sha256(v.numpy().astype('<f4').tobytes()).hexdigest()==schema[k]['sha256_float32']
original=torch.load(root/'frozen-opponent/gae095-seed6011-final.pt',map_location='cpu',weights_only=False)
assert all(torch.equal(original['model'][k],v) for k,v in weights.items())
model.load_state_dict(weights,strict=True);model.eval()
obs=json.loads((root/'frozen-opponent/reference-observations.json').read_text())
with torch.inference_mode():
    policy,values=model(torch.from_numpy(np.stack([encode(o) for o in obs])),torch.from_numpy(mask_array(obs)))
with np.load(root/'frozen-opponent/reference-predictions.npz',allow_pickle=False) as reference:
    error=float(np.max(np.abs(policy.probs.numpy()-reference['probabilities'])))
    assert error<=1e-5,error
    assert np.max(np.abs(values.numpy()-reference['values']))<=1e-5
print(json.dumps({'status':'passed','model_reference_max_abs_error':error,'torch':torch.__version__,
                  'numpy':np.__version__,'full_games':0,'training':False}))
'''

if __name__=='__main__':
    make()
