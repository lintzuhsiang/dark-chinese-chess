"""M1 sequential Experiment 3: fixed protocol, preflight, bounded detached campaign."""
import argparse, json, os, signal, subprocess, sys, time, hashlib, shutil, threading, math
from pathlib import Path
from .runtime import ROOT, load_checkpoint, provenance
from .campaign import atomic_json
TREATMENTS={'baseline':[], 'draw_light':['--draw-penalty','-0.05'], 'draw_strong':['--draw-penalty','-0.2'],
            'curriculum':['--curriculum-rate','0.3'], 'symmetry':['--rotation','1']}
SEEDS=[5011,5023,5037]
ROOT_OUT=ROOT/'benchmark-results/ai7-selfplay/exp3/20261115-m1'

def command_args(name,output,steps,seed=9181):
    result=['--output',str(output),'--seed',str(seed),'--max-env-steps',str(steps),'--threads','2',
        '--batch-games','16','--checkpoint-every-steps',str(max(1,steps//4)), '--validation-pairs','0',
        '--instrumentation','detailed','--audit-records','windowed','--audit-max-bytes','8000000000',
        '--max-replays','2048','--replay-sample-denominator','16',*TREATMENTS[name]]
    if name=='curriculum':result+=['--curriculum-pool',str(ROOT_OUT/'curriculum.json')]
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['prepare','run'],required=True);args=parser.parse_args()
    out=ROOT_OUT;out.mkdir(parents=True,exist_ok=True)
    os.environ.update(AI7_ARTIFACT_ROOT=str(out),AI7_DISK_HEADROOM=str(30*1024**3),PYTHONPYCACHEPREFIX='/tmp/ai7-exp3-cache',MPLCONFIGDIR='/tmp/ai7-exp3-mpl')
    current={'process':None}; stop={'reason':None}
    start=time.time(); deadline=start+7*3600
    def monitor():
        while True:
            if time.time()>deadline-30:stop['reason']='global_deadline'
            elif shutil.disk_usage(ROOT).free<30*1024**3:stop['reason']='disk_headroom'
            if stop['reason']:
                p=current['process']
                if p and p.poll() is None:
                    try:os.killpg(p.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                return
            time.sleep(2)
    threading.Thread(target=monitor,daemon=True).start()
    def child(label,module,arguments,timeout):
        if stop['reason']:raise RuntimeError(stop['reason'])
        logs=out/'logs';logs.mkdir(exist_ok=True)
        record={'label':label,'state':'running','started_epoch':time.time()}
        atomic_json(out/'active-job.json',record)
        with (logs/f'{label}.log').open('w') as log:
            p=subprocess.Popen([sys.executable,'-m',module,*arguments],cwd=ROOT,env=os.environ,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            current['process']=p;record['pid']=p.pid;atomic_json(out/'active-job.json',record)
            try:code=p.wait(timeout=max(1,min(timeout,deadline-time.time()-15)))
            except subprocess.TimeoutExpired:
                os.killpg(p.pid,signal.SIGTERM)
                try:code=p.wait(timeout=15)
                except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);code=p.wait()
            current['process']=None
        record.update(state='completed' if code==0 else 'failed',returncode=code,seconds=time.time()-record['started_epoch'])
        atomic_json(out/'active-job.json',record)
        return record
    if args.mode=='prepare':
        if (out/'config.json').exists():raise FileExistsError('Config exists')
        profiles={}
        from .tests.test_resume import ResumeTests
        compare=ResumeTests()
        for name in TREATMENTS:
            root=out/'gates'/name
            for label,extra in [('full',[]),('split',['--stop-after-updates','1'])]:
                r=child(name+'-'+label,'scripts.ai7.train',command_args(name,root/label,6000)+extra,120)
                if r['returncode']:raise RuntimeError(r)
            r=child(name+'-resume','scripts.ai7.train',command_args(name,root/'split',6000)+['--resume',str(root/'split/latest.pt')],120)
            if r['returncode']:raise RuntimeError(r)
            a=load_checkpoint(root/'full/final.pt')[1];b=load_checkpoint(root/'split/final.pt')[1]
            for key in ['model','optimizer','torch_rng','numpy_rng','python_rng','sampling_rng','opponent_models','opponent_pool','env_steps']:
                compare.assert_nested_equal(a[key],b[key])
            ma=[json.loads(x).get('diagnostics') for x in (root/'full/metrics.jsonl').read_text().splitlines()]
            mb=[json.loads(x).get('diagnostics') for x in (root/'split/metrics.jsonl').read_text().splitlines()]
            assert ma==mb,name
            dest=out/'preflight'/name
            r=child(name+'-preflight','scripts.ai7.train',command_args(name,dest,65536),300)
            if r['returncode']:raise RuntimeError(r)
            summary=json.loads((dest/'summary.json').read_text());assert summary['env_steps']==65536
            profiles[name]={'seconds_per_step':summary['training_wall_seconds']/65536, 'summary':summary}
            atomic_json(out/'preflight-profiles.json',profiles)
            print(name,'passed',flush=True)
        initial=[load_checkpoint(out/'preflight'/n/'initial.pt')[1]['model'] for n in TREATMENTS]
        for weights in initial[1:]:compare.assert_nested_equal(initial[0],weights)
        # 90 minutes evaluation/analysis and 30 minutes slowdown/overhead reserve.
        available=7*3600-5400-1800
        rate=3*sum(x['seconds_per_step'] for x in profiles.values())*1.3
        target=min(3640000, int(available/rate//40000)*40000)
        if target<1000000:raise RuntimeError('Preflight cannot fit a meaningful 15-run comparison')
        jobs=[];names=list(TREATMENTS)
        for i,seed in enumerate(SEEDS):
            for name in names[i:]+names[:i]:jobs.append({'id':f'{name}-seed-{seed}','architecture':name,'seed':seed})
        src=provenance()
        frozen=[ROOT/'benchmark-results/ai7-selfplay/p1p2-comparison/20261114-v1/runs'/r/'final.pt' for r in ['baseline-seed-4011','random_rich-seed-4037']]
        config={'experiment_type':'exp3','architectures':list(TREATMENTS),'seeds':SEEDS,'jobs':jobs,'target_env_steps':target,
          'evaluation_pairs':256,'eval_seed_start':16000000,'historical_seed_start':17000000,
          'max_wall_seconds':25200,'disk_free_reserve_bytes':30*1024**3,'treatments':TREATMENTS,
          'source_hashes':src['source_hashes'],'frozen_opponents':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in frozen},
          'curriculum_sha256':hashlib.sha256((out/'curriculum.json').read_bytes()).hexdigest(),
          'prediction_seconds_with_30pct_margin':target*rate,'gate_passed':True}
        for name in config['source_hashes']:
            dest=out/'source-snapshot'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,dest)
        atomic_json(out/'source-provenance.json',src);atomic_json(out/'config.json',config)
        print(json.dumps({'target':target,'training_forecast_seconds':target*rate}),flush=True)
        return
    config=json.loads((out/'config.json').read_text())
    def check_sources():
        for name,digest in config['source_hashes'].items():
            if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:raise RuntimeError('Source changed: '+name)
    check_sources()
    assert hashlib.sha256((out/'curriculum.json').read_bytes()).hexdigest()==config['curriculum_sha256']
    state={'state':'training','supervisor_pid':os.getpid(),'started_epoch':start,'deadline_epoch':deadline,'target_env_steps':config['target_env_steps'],
           'runs':[{**j,'training':{'state':'pending'}} for j in config['jobs']]}
    if (out/'run-status.json').exists():raise FileExistsError('Campaign already launched')
    def persist():atomic_json(out/'run-status.json',state)
    persist()
    try:
        for run in state['runs']:
            check_sources();dest=out/'runs'/run['id']
            remaining=deadline-time.time()-5400
            if remaining<60:run['training']={'state':'skipped','reason':'evaluation_reserve'};persist();continue
            result=child(run['id'],'scripts.ai7.train',command_args(run['architecture'],dest,config['target_env_steps'],run['seed'])+['--deadline-epoch',str(deadline-5400)],remaining)
            summary=json.loads((dest/'summary.json').read_text()) if (dest/'summary.json').exists() else {}
            run['training']={**result,'env_steps':summary.get('env_steps'), 'state':'completed' if summary.get('env_steps')==config['target_env_steps'] else 'partial'};persist()
        state['state']='evaluation';persist()
        frozen=list(config['frozen_opponents'])
        for p,digest in config['frozen_opponents'].items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==digest
        for run in state['runs']:
            dest=out/'runs'/run['id']
            if not (dest/'final.pt').exists():continue
            result=child(run['id']+'-random','scripts.ai7.evaluate',['--checkpoints',str(dest/'initial.pt'),str(dest/'final.pt'),'--output',str(out/'evaluations'/run['id']),
              '--pairs','256','--seed-start','16000000','--archive-count','16','--deadline-epoch',str(deadline-600)],max(1,deadline-time.time()-600))
            run['evaluation']=result;persist()
            result=child(run['id']+'-historical','scripts.ai7.evaluate',['--checkpoints',str(dest/'initial.pt'),str(dest/'final.pt'),'--historical',*frozen,
              '--output',str(out/'historical-evaluations'/run['id']),'--pairs','128','--seed-start','17000000','--archive-count','0','--deadline-epoch',str(deadline-600)],max(1,deadline-time.time()-600))
            run['historical_evaluation']=result;persist()
        state['state']='additional_analysis';persist()
        extra=child('additional-analysis','scripts.ai7.exp3_analysis',['--campaign',str(out)],max(1,deadline-time.time()-60))
        state['additional_analysis']=extra
        state['state']='completed' if extra['returncode']==0 and all(r['training']['state']=='completed' and r.get('evaluation',{}).get('returncode')==0 and r.get('historical_evaluation',{}).get('returncode')==0 for r in state['runs']) else 'partial'
    except BaseException as exc:
        state.update(state='failed',error=repr(exc));raise
    finally:state['finished_epoch']=time.time();persist()

if __name__=='__main__':main()
