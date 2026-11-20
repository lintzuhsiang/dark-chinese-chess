"""Local analysis of actual M1 2M cohort using unchanged Intel sampling kernels."""
import importlib.util,json,os,sys,hashlib,time,csv,shutil
from pathlib import Path
import numpy as np
ROOT=Path('/Users/lintzu-ting/Desktop/dark-chinese-chess/experiment/selfplay-zero')
REPO=ROOT.parent/'m1-common-eval';B=ROOT.parent/'intel-common-protocol-import/ai7-intel-to-m1-evaluation-protocol'
O=ROOT/'benchmark-results/ai7-selfplay/local-analysis/common-20m-2m-v1';O.mkdir(parents=True,exist_ok=False)
spec=importlib.util.spec_from_file_location('intel_runner',B/'evaluation/runner.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
manifest,protocol,_=runner.source_check(REPO)
runtime,evaluate_checkpoint,paired_difference,result_metrics,load_historical,*_=runner.kernels(REPO)
runtime.seed_all(19,2);historical=load_historical(B)
T=['baseline','draw_light','draw_strong','symmetry'];S=[5011,5023,5037]
C=ROOT/'benchmark-results/ai7-selfplay/exp3/20261115-m1'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(v,indent=2,allow_nan=False)+'\n');tmp.replace(p)
started=time.time();status={'state':'running','started_epoch':started,'cohort':'actual-M1-Exp3-2M','sampling_protocol':'ai7-intel-p0-common-opponent-256-v1','completed_matchups':0,'total_matchups':24,'games_per_matchup':512}
write(O/'status.json',status)
write(O/'configuration.json',{'cohort_id':'m1-local-exp3-2m-on-intel-sampling-v1','steps':2000000,'seeds':S,'treatments':T,'sampling_manifest_sha256':manifest['shared_evaluation_manifest_sha256'],'Intel_manifest_selection_gate':'unchanged in original; this local adapter explicitly authorizes actual M1 2M cohort only','historical_opponent_sha256':manifest['checkpoint_sha256'],'eval_only':True,'reserved_accessed':False})
shutil.copyfile(B/'evaluation/shared-evaluation-manifest.json',O/'exact-sampling-manifest.json')
shutil.copyfile('/tmp/ai7-intel-verify.log',O/'local-conformance.json')
records=[]
try:
 for seed in S:
  for t in T:
   runner.source_check(REPO)
   path=C/'runs'/f'{t}-seed-{seed}'/'final.pt';before=sha(path);model,ck=runtime.load_checkpoint(path)
   assert ck['env_steps']==2000000 and ck['config']['seed']==seed and ck['model_config']=={'architecture':'baseline','input_dim':2163,'width':128}
   identity={'treatment':t,'seed':seed,'steps':2000000,'checkpoint_sha256':before,'config':ck['config']}
   write(O/'identities'/f'{t}-{seed}.json',identity)
   ipc=REPO/'benchmark-results/ai7-selfplay/local-2m-ipc'/f'{t}-{seed}';ipc.mkdir(parents=True)
   os.environ['AI7_ARTIFACT_ROOT']=str(ipc)
   bridge=runtime.Bridge(ipc)
   try:
    for opponent in ['random','historical']:
     status.update(active_run=f'{t}-{seed}',active_opponent=opponent);write(O/'status.json',status)
     r=evaluate_checkpoint(bridge,model,'final',protocol['decks'],'random' if opponent=='random' else 'm1_exp2_baseline_4023',opponent_model=None if opponent=='random' else historical,archive_count=0,batch_games=16)
     assert len(r['games'])==512 and {(g['seed'],g['seat']) for g in r['games']}=={(s,p) for s in protocol['decks'] for p in [0,1]}
     r.update(result_metrics(r['games']));r['identity']=identity;r['opponent_id']=opponent
     write(O/'runs'/f'{t}-{seed}'/f'{opponent}.json',r);records.append(r)
     status['completed_matchups']+=1;write(O/'status.json',status)
     print(t,seed,opponent,r['wins'],r['draws'],r['losses'],flush=True)
   finally:bridge.close()
   assert sha(path)==before
 # Aggregate for description only; matched training-seed uncertainty separate.
 rows=[];paired=[]
 for opponent in ['random','historical']:
  for t in T:
   rs=[r for r in records if r['opponent_id']==opponent and r['identity']['treatment']==t]
   row={'opponent':opponent,'treatment':t,'games':sum(r['completed'] for r in rs),
    **{k:sum(r[k] for r in rs) for k in ['wins','draws','losses']},'score':float(np.mean([r['score'] for r in rs])),
    'no_progress_rate':float(np.mean([r['no_progress_rate'] for r in rs]))}
   rows.append(row)
   if t!='baseline':
    for seed in S:
     base=next(r for r in records if r['opponent_id']==opponent and r['identity']['treatment']=='baseline' and r['identity']['seed']==seed)
     final=next(r for r in rs if r['identity']['seed']==seed)
     getpairs=lambda r:{int(k):v for k,v in r['pair_scores'].items()}
     paired.append({'opponent':opponent,'treatment':t,'seed':seed,**paired_difference(getpairs(base),getpairs(final))})
 sys.path.insert(0,str(ROOT))
 # Exact n=3 t critical, descriptive; no bootstrap games as learning seeds.
 seedcontrasts=[]
 for op in ['random','historical']:
  for t in T[1:]:
   v=np.asarray([r['difference'] for r in paired if r['opponent']==op and r['treatment']==t]);radius=4.30265272975*v.std(ddof=1)/np.sqrt(3)
   seedcontrasts.append({'opponent':op,'treatment':t,'seeds':S,'values':v.tolist(),'mean':float(v.mean()),'t95':[float(v.mean()-radius),float(v.mean()+radius)],'qualification':'exploratory n=3; normality assumed; unadjusted multiple comparisons'})
 write(O/'summary.json',rows);write(O/'paired-deck-comparisons.json',paired);write(O/'training-seed-contrasts.json',seedcontrasts)
 with (O/'summary.csv').open('w') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
 status.update(state='completed',finished_epoch=time.time(),elapsed_seconds=time.time()-started);write(O/'status.json',status)
except BaseException as e:
 status.update(state='failed',error=repr(e),finished_epoch=time.time());write(O/'status.json',status);raise
shutil.copyfile('/tmp/ai7-m1-local-analysis.py',O/'evaluation-driver.py')
print(O,flush=True)
