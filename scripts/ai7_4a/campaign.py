"""Prepare and run the portable Campaign 4A training batch."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from scripts.ai7.runtime import ROOT
from scripts.ai7.shared_protocol import source_evidence, sha256, write_new
from .train import TREATMENTS

SEEDS=[7011,7023,7037]
TARGET=3640000
MILESTONES = {'initial': 0, 'step-000910000': 910000, 'step-001820000': 1820000,
              'step-002730000': 2730000, 'final': TARGET}
EFFECTS={'lambda_without_extra':{'A2':1,'A0':-1},'lambda_with_extra':{'A3':1,'A1':-1},
         'extra_at_095':{'A1':1,'A0':-1},'extra_at_080':{'A3':1,'A2':-1},
         'interaction':{'A3':1,'A2':-1,'A1':-1,'A0':1}}


def read(path, default=None):
    return json.loads(Path(path).read_text()) if Path(path).exists() else default


def atomic(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp'); tmp.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n'); tmp.replace(path)


def command(out,treatment,seed):
    return [sys.executable,'-B','-m','scripts.ai7_4a.train','--treatment',treatment,
            '--output',str(out),'--learning-method','gae_lambda_095','--architecture','baseline',
            '--seed',str(seed),'--max-env-steps',str(TARGET),'--max-updates','100000','--until-step-target',
            '--checkpoint-every-steps','910000','--batch-games','16','--threads','2','--device','cpu',
            '--validation-seed-start','1500000','--validation-pairs','16','--max-replays','4','--instrumentation','basic']


def prepare(campaign, manifest_path, pilot_path):
    if campaign.exists():
        raise FileExistsError(f"Use a fresh campaign directory: {campaign}")
    pilot = read(pilot_path, {})
    if (pilot.get('passed') is not True or pilot.get('A0_exact_model_PPO_pool_RNG_games') is not True
            or pilot.get('resume_exact') != ['A1', 'A2', 'A3']
            or pilot.get('source_hashes') != training_source_hashes()):
        raise ValueError("Campaign 4A requires a completed correctness pilot for this training source")
    if not isinstance(read(manifest_path), dict):
        raise ValueError("An explicit evaluation manifest is required")
    campaign.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(manifest_path, campaign/'shared-evaluation-manifest.json')
    pilot_copy = campaign/'correctness-verification.json'
    shutil.copyfile(pilot_path, pilot_copy)
    evidence=source_evidence()
    paths=set(evidence['source_hashes'])
    paths.update('scripts/ai7_4a/' + name for name in
                 ['__init__.py', 'campaign.py', 'report.py', 'tests.py', 'train.py'])
    paths.add('docs/ai7-campaign4a.md')
    hashes={p:sha256(ROOT/p) for p in sorted(paths)}
    if any(hashes.get(p) != sha for p, sha in pilot["source_hashes"].items()):
        raise ValueError("Training source changed after pilot verification")
    for name,digest in hashes.items():
        destination=campaign/'source-snapshot'/name
        destination.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(ROOT/name,destination)
        assert sha256(destination)==digest
    jobs=[{'id':f'{method}-seed-{seed}','treatment':method,'seed':seed}
          for i,seed in enumerate(SEEDS) for method in list(TREATMENTS)[i:]+list(TREATMENTS)[:i]]
    config={'campaign':'4A GAE x value-head learning','state':'preregistered_before_full_training',
            'jobs':jobs,'training_seeds':SEEDS,'steps_per_run':TARGET,'total_transitions':12*TARGET,
            'milestones':[0,910000,1820000,2730000,TARGET],'treatments':TREATMENTS,
            'extra_optimizer':{'name':'Adam','lr':3e-4,'eps':1e-5,'betas':[.9,.999], 'minibatch':256,
              'value_coefficient':.5,'gradient_clip':.5,'passes':2,'shuffle':False},
            'rollout_target':'frozen pre-PPO GAE return with treatment lambda; no target recomputation in extra phase',
            'standard_PPO':'unchanged scripts.ai7.train.optimize; A0 real-Core equivalence gate passed',
            'source_hashes':hashes,'git_commit':evidence['git_commit'],'git_branch':evidence['git_branch'],
            'source_evidence':evidence,'shared_manifest_sha256':sha256(campaign/'shared-evaluation-manifest.json'),
            'correctness_evidence':[{'path':pilot_copy.name,'sha256':sha256(pilot_copy)}],
            'heavy_processes':1,'training_deadline':None,'failures':'up to 3 exact-resume attempts, then incomplete; never reduce target',
            'final_eval_gate':'Separate authorization, inventory confirmation and a compatible frozen evaluator'}
    write_new(campaign/'config.json',config)
    print(json.dumps({'prepared':str(campaign),'jobs':12,'transitions':12*TARGET}),flush=True)


def training_source_hashes():
    hashes = source_evidence()['source_hashes']
    return {**hashes, 'scripts/ai7_4a/train.py': sha256(ROOT/'scripts/ai7_4a/train.py'),
            'scripts/ai7_4a/tests.py': sha256(ROOT/'scripts/ai7_4a/tests.py')}


def check(campaign, config):
    if sha256(campaign/'shared-evaluation-manifest.json') != config['shared_manifest_sha256']:
        raise ValueError("Evaluation manifest has changed since preparation")
    for record in config['correctness_evidence']:
        if sha256(campaign/record['path']) != record['sha256']:
            raise ValueError("Correctness evidence has changed since preparation")
    for name,digest in config['source_hashes'].items():
        if sha256(ROOT/name)!=digest: raise RuntimeError('Source changed after preregistration: '+name)


def checkpoints(campaign, config):
    result=[]
    for job in config['jobs']:
        run=campaign/'runs'/job['id']; summary=read(run/'summary.json',{})
        if summary.get('status')!='completed' or summary.get('env_steps')!=TARGET: continue
        for label, steps in MILESTONES.items():
            path=run/(label+'.pt'); assert path.is_file()
            result.append({**job,'endpoint':label,'env_steps':steps,'path':str(path),'sha256':sha256(path)})
    atomic(campaign/'checkpoint-index.json',result)
    return result


def reports(campaign, config, status):
    from .report import produce
    produce(campaign,config,status)


def run(campaign):
    with (campaign/'supervisor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        train_batch(campaign)


def train_batch(campaign):
    config=read(campaign/'config.json')
    check(campaign, config)
    env={**os.environ,'AI7_ARTIFACT_ROOT':str(campaign),'AI7_DISK_HEADROOM':'3000000000',
         'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1','OMP_NUM_THREADS':'2','MKL_NUM_THREADS':'2',
         'OPENBLAS_NUM_THREADS':'2','VECLIB_MAXIMUM_THREADS':'2','MPLCONFIGDIR':str(campaign/'matplotlib-cache')}
    state={'pid':os.getpid(),'started_epoch':time.time(),'jobs':{},'state':'training'}
    try:
        for job in config['jobs']:
            check(campaign, config); out=campaign/'runs'/job['id']; out.parent.mkdir(exist_ok=True)
            for attempt in range(3):
                summary=read(out/'summary.json',{})
                if summary.get('status')=='completed' and summary.get('env_steps')==TARGET: break
                cmd=command(out,job['treatment'],job['seed'])
                if out.exists():
                    if not (out/'latest.pt').exists():
                        state['jobs'][job['id']]={'state':'failed','error':'Output exists without resumable checkpoint; preserved'}; break
                    cmd+=['--resume',str(out/'latest.pt')]
                state.update(active_job=job['id'],attempt=attempt+1)
                atomic(campaign/'status.json',state)
                log=campaign/'logs'/f"{job['id']}-attempt{attempt+1}-{time.time_ns()}.log"; log.parent.mkdir(exist_ok=True)
                with log.open('w') as stream:
                    child=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT)
                    state['child_pid']=child.pid;atomic(campaign/'status.json',state)
                    code=child.wait()
                summary=read(out/'summary.json',{})
                state['jobs'][job['id']]={'state':summary.get('status','failed'),'env_steps':summary.get('env_steps'),
                                        'returncode':code,'log':str(log.relative_to(campaign))}
                atomic(campaign/'status.json',state)
            state['jobs'][job['id']]={**state['jobs'].get(job['id'],{}),**{'state':read(out/'summary.json',{}).get('status','failed'),
                                      'env_steps':read(out/'summary.json',{}).get('env_steps')}}
        index = checkpoints(campaign, config)
        complete = len(index) == len(config['jobs']) * len(MILESTONES)
        state.update(state='training_complete' if complete else 'incomplete_training', finished_epoch=time.time())
        atomic(campaign/'status.json',state)
        reports(campaign, config, state['state'])
    except BaseException as error:
        state.update(state='failed',error=repr(error));atomic(campaign/'status.json',state)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    preparation = actions.add_parser('prepare')
    preparation.add_argument('--manifest', type=Path, required=True)
    preparation.add_argument('--pilot', type=Path, required=True)
    for command_parser in (preparation, actions.add_parser('run')):
        command_parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    campaign = args.output.resolve()
    if not campaign.is_relative_to(ROOT/'benchmark-results/ai7-selfplay'):
        parser.error("--output must be inside benchmark-results/ai7-selfplay")
    if args.action == 'prepare':
        prepare(campaign, args.manifest, args.pilot)
    else:
        run(campaign)


if __name__ == '__main__':
    main()
