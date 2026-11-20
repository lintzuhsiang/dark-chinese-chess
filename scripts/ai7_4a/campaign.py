"""Sequential resumable 12-run Campaign 4A and fixed-protocol evaluation."""
import argparse
import csv
import fcntl
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import time

import numpy as np
import torch

from scripts.ai7.runtime import ROOT, Bridge, collect, encode, mask_array, load_checkpoint, seed_all
from scripts.ai7.evaluate import evaluate_checkpoint
from scripts.ai7.evaluate_shared import result_metrics
from scripts.ai7.shared_protocol import source_evidence, sha256, write_new
from scripts.ai7_p0.common import load_historical, target_metrics, paired_statistics
from .reference import CAMPAIGN, P0, OLD
from .train import TREATMENTS

SEEDS=[7011,7023,7037]
TARGET=3640000
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


def prepare():
    manifest=read(CAMPAIGN/'shared-evaluation-manifest.json')
    assert manifest and manifest['state']=='proposed_pending_M1_inventory_confirmation'
    evidence=source_evidence()
    paths=set(evidence['source_hashes'])
    paths.update(p.relative_to(ROOT).as_posix() for p in (ROOT/'scripts/ai7_4a').glob('*.py'))
    paths.add('docs/ai7-campaign4a.md')
    hashes={p:sha256(ROOT/p) for p in sorted(paths)}
    for name,digest in hashes.items():
        destination=CAMPAIGN/'source-snapshot'/name
        destination.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(ROOT/name,destination)
        assert sha256(destination)==digest
    pilots=list((CAMPAIGN/'pilots').glob('correctness-*/verification.json'))
    assert pilots and all(read(p)['passed'] for p in pilots)
    original_gate=CAMPAIGN/'preparation/original-snapshot-A0-equivalence.json'
    assert read(original_gate)['status']=='passed'
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
            'source_evidence':evidence,'shared_manifest_sha256':sha256(CAMPAIGN/'shared-evaluation-manifest.json'),
            'correctness_evidence':[{'path':str(p.relative_to(CAMPAIGN)),'sha256':sha256(p)} for p in [*pilots,original_gate]],
            'heavy_processes':1,'training_deadline':None,'failures':'up to 3 exact-resume attempts, then incomplete; never reduce target',
            'final_eval_gate':'M1 confirmation file matching immutable manifest SHA; independent training proceeds'}
    write_new(CAMPAIGN/'config.json',config)
    print(json.dumps({'prepared':str(CAMPAIGN),'jobs':12,'transitions':12*TARGET}),flush=True)


def check(config):
    assert sha256(CAMPAIGN/'shared-evaluation-manifest.json')==config['shared_manifest_sha256']
    for name,digest in config['source_hashes'].items():
        if sha256(ROOT/name)!=digest: raise RuntimeError('Source changed after preregistration: '+name)


def verify_opponents(manifest):
    models={}; identities={}
    directory=P0/'imports/intel-evaluation-bundle'
    for row in manifest['opponents']:
        name=row['name']
        if name=='random': continue
        path=(directory/'historical-opponent/baseline-seed-4023-step-3640000.pt') if name=='m1_exp2_baseline_4023' else OLD/'runs/gae_lambda_095-seed-6011/final.pt'
        assert sha256(path)==row['checkpoint_sha256'],name
        model,meta=load_checkpoint(path)
        assert meta['model_config']=={'architecture':'baseline','input_dim':2163,'width':128}
        models[name]=model; identities[name]={'path':str(path),'sha256':sha256(path),'config':meta['config'],
            'core_revision':meta['core_revision'],'observation_version':meta['observation_version']}
    atomic(CAMPAIGN/'frozen-opponent-verification.json',identities)
    return models


def checkpoints(config):
    result=[]
    for job in config['jobs']:
        run=CAMPAIGN/'runs'/job['id']; summary=read(run/'summary.json',{})
        if summary.get('status')!='completed' or summary.get('env_steps')!=TARGET: continue
        for label,steps in [('initial',0),('step-000910000',910000),('step-001820000',1820000),('step-002730000',2730000),('final',TARGET)]:
            path=run/(label+'.pt'); assert path.is_file()
            result.append({**job,'endpoint':label,'env_steps':steps,'path':str(path),'sha256':sha256(path)})
    atomic(CAMPAIGN/'checkpoint-index.json',result)
    return result


def tactical(config):
    bank_path=P0/'imports/intel-evaluation-bundle/tactical-bank/stage2.json'
    assert sha256(bank_path)=='970fa685171b61d3b9a43c515e5cbfdd47801885ef259ca65aa3b345bc603d27'
    bank=read(bank_path)['bank']; assert len(bank)==400
    rotation=np.array(read(bank_path.parent/'action-rotation.json')['rotation'])
    obs=[o for row in bank for o in [row['observation'],row['rotated']]]
    features=torch.from_numpy(np.stack([encode(o) for o in obs])); masks=torch.from_numpy(mask_array(obs))
    results=[]
    for cp in checkpoints(config):
        destination=CAMPAIGN/'tactical'/f"{cp['id']}-{cp['endpoint']}.json"
        if destination.exists():
            row=read(destination); assert row['checkpoint']['sha256']==cp['sha256']; results.append(row); continue
        model,_=load_checkpoint(cp['path'])
        with torch.inference_mode():
            probabilities=torch.cat([model(features[i:i+128],masks[i:i+128])[0].probs for i in range(0,800,128)]).numpy()
        assert np.isfinite(probabilities).all() and not probabilities[~masks.numpy()].any()
        rows=[]
        for i,row in enumerate(bank):
            targets=row['labels']['wins' if row['category']=='win' else 'safe']
            a=target_metrics(probabilities[2*i],row['observation']['legal'],targets)
            b=target_metrics(probabilities[2*i+1],row['rotated']['legal'],rotation[targets].tolist())
            legal=row['observation']['legal']
            rows.append({'id':row['id'],'category':row['category'],
                         'target_probability':(a['target_probability']+b['target_probability'])/2,
                         'top1_accuracy':(a['top1_correct']+b['top1_correct'])/2,
                         'best_target_rank':(a['best_target_rank']+b['best_target_rank'])/2,
                         'equivariance_tv':float(.5*np.abs(probabilities[2*i,legal]-probabilities[2*i+1,rotation[legal]]).sum())})
        summary={category:{metric:float(np.mean([r[metric] for r in rows if r['category']==category]))
                 for metric in ['target_probability','top1_accuracy','best_target_rank','equivariance_tv']}
                 for category in ['win','defense']}
        row={'checkpoint':cp,'bank_sha256':sha256(bank_path),'summary':summary,'positions':rows,'reserved_access':False}
        atomic(destination,row); results.append(row)
    atomic(CAMPAIGN/'tactical-results.json',results)


def calibration(manifest,models,index):
    destination=CAMPAIGN/'calibration-reference.npz'
    if not destination.exists():
        features=[]; targets=[]; groups=[]; games=[]
        bridge=Bridge(CAMPAIGN/'calibration-replays')
        try:
            specs=[{'seed':s,'seat':seat,'action_seed':s^0x13579,'opponent':'m1_exp2_baseline_4023'}
                   for s in manifest['calibration']['deck_seeds'] for seat in [0,1]]
            for offset in range(0,len(specs),16):
                report=collect(bridge,models['intel_gae095_seed6011'],specs[offset:offset+16],models,training=True)
                assert report['incomplete']==0
                for trajectory in report['trajectories']:
                    group=len(set(groups))
                    for i in np.unique(np.linspace(0,len(trajectory)-1,min(8,len(trajectory)),dtype=int)):
                        features.append(trajectory[i]['features']);targets.append(trajectory[-1]['reward']);groups.append(group)
                games.extend(report['games'])
        finally: bridge.close()
        np.savez_compressed(destination,features=np.stack(features),targets=np.array(targets),groups=np.array(groups))
        atomic(CAMPAIGN/'calibration-reference.json',{'games':games,'npz_sha256':sha256(destination),'definition':manifest['calibration']})
    data=np.load(destination,allow_pickle=False); x=torch.from_numpy(data['features']); targets=data['targets']; groups=data['groups']
    rows=[]
    for cp in index:
        model,_=load_checkpoint(cp['path'])
        with torch.inference_mode(): values=torch.cat([model.critic(model.body(part)).squeeze(-1) for part in x.split(128)]).numpy()
        errors=(values-targets)**2; variance=np.var(targets)
        bins=[]
        for low,high in zip(np.linspace(-1,1,11)[:-1],np.linspace(-1,1,11)[1:]):
            selected=(values>=low)&(values<high if high<1 else values<=high)
            if selected.any(): bins.append({'low':float(low),'high':float(high),'count':int(selected.sum()),
                'mean_prediction':float(values[selected].mean()),'mean_return':float(targets[selected].mean())})
        rows.append({'checkpoint':cp,'mse':float(errors.mean()),'prediction_mean':float(values.mean()),
            'explained_variance':float(1-np.var(targets-values)/variance) if variance else None,'bins':bins,
            'per_reference_deck_mse':{str(g):float(errors[(groups//2)==g].mean()) for g in np.unique(groups//2)},
            'qualification':'Identical public states and sampled reference-policy returns; off-policy for learned models, not exact V_pi ground truth'})
    atomic(CAMPAIGN/'calibration-results.json',rows)


def games(config,manifest,models):
    expected={(s,seat) for s in manifest['deck_seeds'] for seat in [0,1]}
    bridge=Bridge(CAMPAIGN/'evaluation-replays')
    try:
        for cp in checkpoints(config):
            if cp['endpoint']!='final': continue
            for opponent in manifest['opponents']:
                name=opponent['name']; destination=CAMPAIGN/'games'/f"{cp['id']}-vs-{name}.json"
                if destination.exists():
                    previous=read(destination)
                    assert previous['checkpoint']['sha256']==cp['sha256'] and previous['manifest_sha256']==config['shared_manifest_sha256']
                    assert previous['completed']==512
                    continue
                model,_=load_checkpoint(cp['path'])
                report=evaluate_checkpoint(bridge,model,'final',manifest['deck_seeds'],name,models.get(name),archive_count=0,batch_games=16)
                assert {(g['seed'],g['seat']) for g in report['games']}==expected and len(report['games'])==512
                report.update(result_metrics(report['games']))
                report.update(checkpoint=cp,manifest_sha256=config['shared_manifest_sha256'],
                              opponent_identity=opponent,errors=0)
                assert sha256(cp['path'])==cp['sha256']
                atomic(destination,report)
    finally: bridge.close()


def m1_confirmed(config):
    response=read(CAMPAIGN/'m1-confirmation.json',{})
    return (response.get('manifest_sha256')==config['shared_manifest_sha256'] and response.get('status')=='CONFIRMED'
            and response.get('deck_overlap')=='none' and response.get('calibration_overlap')=='none'
            and response.get('reserved_bank_opened') is False
            and isinstance(response.get('M1_inventory_sha256'),str) and len(response['M1_inventory_sha256'])==64)


def reports(config,status):
    from .report import produce
    produce(CAMPAIGN,config,status)


def run():
    lock=(CAMPAIGN/'supervisor.lock').open('a'); fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    config=read(CAMPAIGN/'config.json'); check(config); seed_all(19,2)
    manifest=read(CAMPAIGN/'shared-evaluation-manifest.json'); models=verify_opponents(manifest)
    env={**os.environ,'AI7_ARTIFACT_ROOT':str(CAMPAIGN),'AI7_DISK_HEADROOM':'3000000000',
         'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1','OMP_NUM_THREADS':'2','MKL_NUM_THREADS':'2',
         'OPENBLAS_NUM_THREADS':'2','VECLIB_MAXIMUM_THREADS':'2','MPLCONFIGDIR':str(CAMPAIGN/'matplotlib-cache')}
    state={'pid':os.getpid(),'started_epoch':time.time(),'jobs':{},'state':'training'}
    try:
        for job in config['jobs']:
            check(config); out=CAMPAIGN/'runs'/job['id']; out.parent.mkdir(exist_ok=True)
            for attempt in range(3):
                summary=read(out/'summary.json',{})
                if summary.get('status')=='completed' and summary.get('env_steps')==TARGET: break
                cmd=command(out,job['treatment'],job['seed'])
                if out.exists():
                    if not (out/'latest.pt').exists():
                        state['jobs'][job['id']]={'state':'failed','error':'Output exists without resumable checkpoint; preserved'}; break
                    cmd+=['--resume',str(out/'latest.pt')]
                state.update(active_job=job['id'],attempt=attempt+1)
                atomic(CAMPAIGN/'status.json',state)
                log=CAMPAIGN/'logs'/f"{job['id']}-attempt{attempt+1}-{time.time_ns()}.log"; log.parent.mkdir(exist_ok=True)
                with log.open('w') as stream:
                    child=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT)
                    state['child_pid']=child.pid;atomic(CAMPAIGN/'status.json',state)
                    code=child.wait()
                summary=read(out/'summary.json',{})
                state['jobs'][job['id']]={'state':summary.get('status','failed'),'env_steps':summary.get('env_steps'),
                                        'returncode':code,'log':str(log.relative_to(CAMPAIGN))}
                atomic(CAMPAIGN/'status.json',state)
            state['jobs'][job['id']]={**state['jobs'].get(job['id'],{}),**{'state':read(out/'summary.json',{}).get('status','failed'),
                                      'env_steps':read(out/'summary.json',{}).get('env_steps')}}
        state.update(state='secondary_diagnostics',training_finished_epoch=time.time());atomic(CAMPAIGN/'status.json',state)
        tactical(config); reports(config,'training_complete_waiting_for_M1_inventory_confirmation')
        while not m1_confirmed(config):
            state.update(state='awaiting_M1_inventory_confirmation')
            atomic(CAMPAIGN/'status.json',state);time.sleep(30)
        check(config)
        atomic(CAMPAIGN/'protocol-freeze-confirmation.json',{'manifest_sha256':config['shared_manifest_sha256'],
               'M1_confirmation':read(CAMPAIGN/'m1-confirmation.json'),'frozen_before_new_final_results':True})
        state['state']='evaluation';atomic(CAMPAIGN/'status.json',state)
        os.environ.update(env)
        calibration(manifest,models,checkpoints(config));games(config,manifest,models)
        reports(config,'completed' if all(r.get('env_steps')==TARGET and r.get('state')=='completed' for r in state['jobs'].values()) else 'incomplete_training')
        state.update(state='completed' if len(checkpoints(config))==60 else 'incomplete',finished_epoch=time.time())
        atomic(CAMPAIGN/'status.json',state)
    except BaseException as error:
        state.update(state='failed',error=repr(error));atomic(CAMPAIGN/'status.json',state)
        reports(config,'failed');raise


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['prepare','run']);args=parser.parse_args()
    prepare() if args.action=='prepare' else run()


if __name__=='__main__': main()
