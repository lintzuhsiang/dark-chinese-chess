"""Frozen sequential M1 Campaign 4B execution; no held-out evaluation or B3 substitution."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
import resource
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
from .runtime import ROOT, load_checkpoint, provenance

CAMPAIGN = ROOT / 'benchmark-results/ai7-selfplay/gae-restart-strategies-20261115'
EXECUTION = CAMPAIGN / 'verified-training-v1'
ARCHIVE = CAMPAIGN / 'archive/archive.json'
ARCHIVE_SHA = '7bc7885f86d83c7bb3054d3672bdaf3531f55e012f190b0d3a9f5dcaf7b7fb71'


def write(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def arguments(treatment, seed, output, steps):
    return ['--output', str(output), '--learning-method', 'gae_lambda_095', '--until-step-target',
        '--restart-treatment', treatment, '--restart-archive', str(ARCHIVE),
        '--restart-archive-sha256', ARCHIVE_SHA, '--architecture', 'baseline', '--seed', str(seed),
        '--max-env-steps', str(steps), '--max-updates', '100000', '--checkpoint-every-steps', str(steps//4),
        '--batch-games', '16', '--threads', '2', '--device', 'cpu', '--validation-seed-start', '1500000',
        '--validation-pairs', '16', '--max-replays', '4', '--instrumentation', 'basic']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'pilot', 'run', 'launch'])
    args = parser.parse_args()
    if args.mode == 'prepare':
        validation = json.loads((CAMPAIGN/'intel-compatibility-validation.json').read_text())
        if validation['status'] != 'passed':
            raise RuntimeError('Intel compatibility gate not passed')
        if hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() != ARCHIVE_SHA:
            raise RuntimeError('Fixed archive changed')
        EXECUTION.mkdir(exist_ok=False)
        source = provenance()
        for name in source['source_hashes']:
            destination = EXECUTION/'source-snapshot'/name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT/name, destination)
        jobs=[]
        for i, seed in enumerate([7011,7023,7037]):
            names=['B0','B1','B2']
            for treatment in names[i:]+names[:i]:
                jobs.append({'id':f'{treatment}-seed-{seed}','treatment':treatment,'seed':seed})
        write(EXECUTION/'config.json',{'jobs':jobs,'steps_per_run':3640000,
            'archive_sha256':ARCHIVE_SHA,'source':source,
            'B3':'unavailable: no verified replicated hidden-layout public-state outcome targets; no handcrafted substitute',
            'evaluation':'pending new Intel shared-manifest overlap confirmation; no evaluation launched',
            'requested_runs':12,'valid_runs':9,'unavailable_runs':3})
        print(EXECUTION/'config.json')
        return
    config=json.loads((EXECUTION/'config.json').read_text())
    for name,digest in config['source']['source_hashes'].items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:
            raise RuntimeError('Frozen source changed: '+name)
    env={**os.environ,'AI7_ARTIFACT_ROOT':str(EXECUTION),'PYTHONPYCACHEPREFIX':'/private/tmp/ai7-4b-cache',
        'MPLCONFIGDIR':'/private/tmp/ai7-4b-mpl','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','PYTHONUNBUFFERED':'1'}
    if args.mode=='launch':
        if not (EXECUTION/'pilot-gates.json').exists():
            raise RuntimeError('Training pilots not passed')
        launch=EXECUTION/'launch.json'
        if launch.exists():
            raise FileExistsError('Launch already recorded; inspect existing process/status')
        command=['/usr/bin/nice','-n','10','/usr/bin/nohup','/usr/bin/caffeinate','-i',sys.executable,'-m','scripts.ai7.restart_campaign','run']
        with (EXECUTION/'supervisor.log').open('x') as log:
            process=subprocess.Popen(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        write(launch,{'pid':process.pid,'command':command,'started_epoch':time.time()})
        print(json.dumps({'launched_pid':process.pid}))
        return
    lock=(EXECUTION/'execution.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    child=None
    stopped=False
    def stop(number,_frame):
        nonlocal stopped
        stopped=True
        if child is not None and child.poll() is None:
            os.killpg(child.pid,number)
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    pilot=args.mode=='pilot'
    if not pilot and not (EXECUTION/'pilot-gates.json').exists():
        raise RuntimeError('Training pilots not passed')
    jobs=[{'id':t,'treatment':t,'seed':87041} for t in ['B0','B1','B2']] if pilot else config['jobs']
    status_path=EXECUTION/('pilot-status.json' if pilot else 'run-status.json')
    if status_path.exists():
        raise FileExistsError('Execution already recorded; explicit recovery required')
    state={'phase':'pilot' if pilot else 'training','supervisor_pid':os.getpid(),'started_epoch':time.time(),'jobs':[]}
    write(status_path,state)
    for job in jobs:
        if stopped: break
        if shutil.disk_usage(ROOT).free<30*1024**3:
            raise RuntimeError('Less than 30 GiB disk headroom; no artifact deletion')
        steps=65536 if pilot else config['steps_per_run']
        output=EXECUTION/('pilots' if pilot else 'runs')/job['id']
        log=EXECUTION/(('pilot-' if pilot else '')+job['id']+'.log')
        record={**job,'status':'running','command':[sys.executable,'-m','scripts.ai7.train',*arguments(job['treatment'],job['seed'],output,steps)],'started_epoch':time.time()}
        state['jobs'].append(record);write(status_path,state)
        cpu_before=resource.getrusage(resource.RUSAGE_CHILDREN)
        with log.open('x') as handle:
            child=subprocess.Popen(record['command'],cwd=ROOT,env=env,stdout=handle,stderr=subprocess.STDOUT,start_new_session=True)
            record['pid']=child.pid;write(status_path,state)
            code=child.wait()
        cpu_after=resource.getrusage(resource.RUSAGE_CHILDREN)
        record.update(returncode=code,wall_seconds=time.time()-record['started_epoch'],
            child_user_cpu_seconds=cpu_after.ru_utime-cpu_before.ru_utime,
            child_system_cpu_seconds=cpu_after.ru_stime-cpu_before.ru_stime)
        summary=json.loads((output/'summary.json').read_text()) if (output/'summary.json').exists() else {}
        record.update(env_steps=summary.get('env_steps'),status=summary.get('status','failed'))
        if code or summary.get('status')!='completed' or summary.get('env_steps')!=steps:
            state['phase']='partial';write(status_path,state)
            raise RuntimeError('Run incomplete; preserve artifacts and investigate: '+job['id'])
        checkpoint=output/'final.pt'
        model,metadata=load_checkpoint(checkpoint)
        if metadata['env_steps']!=steps or metadata['config']['gae_lambda']!=.95:
            raise RuntimeError('Final checkpoint configuration/step mismatch')
        record['final_sha256']=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        record['training_seconds']=summary['actual_training_seconds']
        record['training_steps_per_second']=steps/summary['actual_training_seconds']
        write(status_path,state)
    state['phase']='stopped' if stopped else ('passed' if pilot else 'training-completed-awaiting-evaluation')
    state['finished_epoch']=time.time();write(status_path,state)
    if pilot and not stopped:
        write(EXECUTION/'pilot-gates.json',state)
    print(json.dumps(state))


if __name__=='__main__':main()
