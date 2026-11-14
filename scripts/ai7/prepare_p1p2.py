"""Predeclared single-factor P1/P2 campaign, sequential smoke and feasibility."""
import json,os,subprocess,sys,time,math,hashlib
from pathlib import Path
from .runtime import ROOT,provenance,write_json
from .campaign import validate_config,Supervisor
TREATMENTS={'baseline':{'learning_rate':.0003,'opponent_mixture':'standard'},'low_lr':{'learning_rate':.0001,'opponent_mixture':'standard'},'random_rich':{'learning_rate':.0003,'opponent_mixture':'random_rich'}}
SEEDS=[4011,4023,4037]

def main():
 root=ROOT/'benchmark-results/ai7-selfplay/p1p2-comparison/20261114-v1';root.mkdir(parents=True,exist_ok=False)
 os.environ['AI7_ARTIFACT_ROOT']=str(root);os.environ['MPLCONFIGDIR']='/tmp/ai7-p1p2-matplotlib'
 profiles={}
 for name,treatment in TREATMENTS.items():
  out=root/'preflight'/name;out.parent.mkdir(exist_ok=True)
  cmd=[sys.executable,'-m','scripts.ai7.train','--output',str(out),'--seed','9081','--max-env-steps','65536','--checkpoint-every-steps','910000','--max-replays','0','--validation-pairs','32','--validation-seed-start','1300000','--threads','2','--instrumentation','detailed','--learning-rate',str(treatment['learning_rate']),'--opponent-mixture',treatment['opponent_mixture']]
  with (out.parent/f'{name}.stdout.jsonl').open('w') as stdout,(out.parent/f'{name}.stderr.log').open('w') as stderr:
   result=subprocess.run(cmd,cwd=ROOT,env=os.environ,stdout=stdout,stderr=stderr,timeout=300)
  assert result.returncode==0,name
  summary=json.loads((out/'summary.json').read_text());assert summary['env_steps']==65536 and summary['checkpoint_exact_reload']
  profiles[name]=summary;write_json(root/'preflight-profiles.json',profiles)
  # Exercise frozen-checkpoint evaluation and both new confirmation suites before launch.
  evaluation=root/'preflight'/f'{name}-evaluation'
  with (out.parent/f'{name}-eval.log').open('w') as log:
   subprocess.run([sys.executable,'-m','scripts.ai7.evaluate','--checkpoints',str(out/'initial.pt'),str(out/'final.pt'),'--output',str(evaluation),'--pairs','2','--seed-start','6100000','--archive-count','0'],stdout=log,stderr=log,check=True,timeout=90)
   subprocess.run([sys.executable,'-m','scripts.ai7.research','--checkpoint',str(out/'final.pt'),'--initial-checkpoint',str(out/'initial.pt'),'--probe-output',str(root/'preflight'/f'{name}-probes.json'),'--confirmation-probes'],stdout=log,stderr=log,check=True,timeout=60)
  print(name,summary['actual_training_seconds'],flush=True)
 costs={name:s['actual_training_seconds']/65536 for name,s in profiles.items()}
 available=25200-5400-180-300-9*90
 target=min(3640000,math.floor(available/(3*sum(costs.values())*1.5)/10000)*10000)
 assert target>=910000,'Insufficient capacity for a meaningful common comparison'
 groups=list(TREATMENTS)
 jobs=[{'id':f'{g}-seed-{seed}','architecture':g,'seed':seed} for i,seed in enumerate(SEEDS) for g in groups[i:]+groups[:i]]
 frozen=ROOT/'benchmark-results/ai7-selfplay/overnight-comparison/20261114-v1/runs/baseline-seed-11/final.pt'
 source=provenance()
 config={'experiment_type':'p1p2','architectures':groups,'seeds':SEEDS,'jobs':jobs,'treatments':TREATMENTS,
 'max_wall_seconds':25200,'max_artifact_bytes':5000000000,'target_env_steps':target,'milestone_steps':910000,
 'threads':2,'batch_games':16,'reserve_evaluation_seconds':5400,'reserve_report_seconds':180,
 'per_run_training_seconds':min(24000,math.ceil(target*max(costs.values())*2+180)),
 'evaluation_pairs':256,'eval_seed_start':6000000,'validation_seed_start':1300000,'validation_pairs':32,
 'eligible_architectures':groups,'historical_opponent':str(frozen),'historical_opponent_sha256':hashlib.sha256(frozen.read_bytes()).hexdigest(),
 'source_hashes':source['source_hashes'],'source_revision':source['source_revision'],'core_revision':source['core_revision'],
 'feasibility':{'measured_seconds_per_step':costs,'training_estimate_seconds':3*target*sum(costs.values()),'training_50pct_slowdown_plus_overhead':3*target*sum(costs.values())*1.5+810,'equally_reduced_before_launch':target<3640000},
 'protocol':{'model':'baseline MLP in every arm','reward':[1,0,-1],'gamma':1,'lambda':1,'epochs':4,'clip':.2,'entropy':.01,'warmup_updates':4,'checkpoint_selection':'final predetermined endpoint, never chosen by probe/validation/final-test score','instrumentation':'P0 detailed: updates1-10 then every10; first minibatch each epoch','confirmation_probes':'new Core-replayed symmetry counterparts; narrow confirmation only','historical_pairs':64,'historical_seed_start':7000000}}
 validate_config(config,root);write_json(root/'config.json',config);write_json(root/'source-provenance.json',source)
 for name,digest in source['source_hashes'].items():
  data=(ROOT/name).read_bytes();assert hashlib.sha256(data).hexdigest()==digest
  dest=root/'source-snapshot'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
 Supervisor(root,config).check_sources()
 from .research import build_report
 build_report(root)
 print(json.dumps({'target':target,'feasibility':config['feasibility'],'output':str(root)}),flush=True)
if __name__=='__main__':main()
