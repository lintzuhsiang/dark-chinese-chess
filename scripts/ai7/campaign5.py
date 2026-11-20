"""Campaign5: frozen 20M exploratory evaluation, four treatments, ten-hour bound."""
from __future__ import annotations
import argparse,ast,csv,fcntl,hashlib,json,os,resource,shutil,signal,statistics,subprocess,sys,time
from pathlib import Path
import numpy as np
import torch
from .runtime import ROOT,Bridge,load_checkpoint,seed_all,encode,mask_array,provenance
from .train import configuration,parse_args
from .evaluate import evaluate_checkpoint,paired_difference
from .evaluate_shared import result_metrics
from .analysis.symmetry import rotate_ids

OUT=ROOT/'benchmark-results/ai7-selfplay/campaign5-lambda-restart-density-20261116'
OLD=ROOT/'benchmark-results/ai7-selfplay/gae-restart-strategies-20261115'
RUNS=OLD/'verified-training-v1/runs'
BUNDLE=ROOT.parent/'intel-common-protocol-import/ai7-intel-to-m1-evaluation-protocol'
SEEDS=[7011,7023,7037]
MATRIX={'C1-L90':('B0',['--gae-lambda','.90']), 'C1-L85':('B0',['--gae-lambda','.85']), 'C2-R50':('B2',['--restart-probability','.5']), 'C2-R70':('B2',['--restart-probability','.7'])}

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(v,indent=2,allow_nan=False)+'\n');tmp.replace(p)
def csvwrite(p,rows):
 if not rows:return
 with p.open('w') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
def command(t,seed,dest,steps=3640000):
 control,extra=MATRIX[t];base=load_checkpoint(RUNS/f'{control}-seed-{seed}'/'final.pt')[1]['config']
 args=['--output',str(dest),'--learning-method','gae_lambda_095','--until-step-target','--restart-treatment',control,'--restart-archive',base['restart_archive'],'--restart-archive-sha256',base['restart_archive_sha256'],'--seed',str(seed),'--max-env-steps',str(steps),'--max-updates','100000','--checkpoint-every-steps',str(910000 if steps==3640000 else steps//4),'--batch-games','16','--threads','2','--device','cpu','--validation-seed-start','1500000','--validation-pairs','16','--max-replays','4','--instrumentation','basic',*extra]
 return args

def prepare():
 if (OUT/'experiment-manifest.json').exists():raise FileExistsError('Campaign manifest already frozen')
 OUT.mkdir(parents=True,exist_ok=True)
 shutil.copyfile(BUNDLE/'evaluation/shared-evaluation-manifest.json',OUT/'exploratory-20m-manifest.json')
 protocol=json.loads((OUT/'exploratory-20m-manifest.json').read_text());assert protocol['protocol_id']=='ai7-intel-p0-common-opponent-256-v1' and protocol['decks']==list(range(20000000,20000256))
 controls=[]
 for t in ['B0','B1','B2']:
  for seed in SEEDS:
   p=RUNS/f'{t}-seed-{seed}'/'final.pt';_,ck=load_checkpoint(p);assert ck['env_steps']==3640000 and ck['config']['seed']==seed
   controls.append({'treatment':t,'seed':seed,'path':str(p),'sha256':sha(p),'config':ck['config']})
 opponents={'random':None,'historical':BUNDLE/'historical-opponent/baseline-seed-4023-step-3640000.pt','intel':OLD/'imports/intel-gae095-training-reference-v1/frozen-opponent/gae095-seed6011-final.pt'}
 assert sha(opponents['historical'])=='d7b5623b61b26b1f17dd93189a512c3c0f81a4c9d8bd7a3131728078c53bb4b8'
 assert sha(opponents['intel'])=='0206ee8acf78a23ce9bb0e0e1e7eb6521b56f0b960de72a624a598fa36729d7e'
 jobs=[]
 ignored={'output','deadline_epoch'}
 for seed in SEEDS:
  for t,(control,_) in MATRIX.items():
   args=command(t,seed,OUT/'runs'/f'{t}-seed-{seed}');new=configuration(parse_args(args));old=next(c['config'] for c in controls if c['treatment']==control and c['seed']==seed)
   diff={k:[old.get(k),new.get(k)] for k in old.keys()|new.keys() if old.get(k)!=new.get(k)}
   behavioral=set(diff)-ignored
   assert behavioral==({'gae_lambda'} if t.startswith('C1') else {'restart_probability'}),(t,diff)
   jobs.append({'id':f'{t}-seed-{seed}','treatment':t,'seed':seed,'args':args,'config_differences':diff,'status':'pending'})
 bank=ROOT.parent/'selfplay-zero/benchmark-results/ai7-selfplay/symmetry-audit/20261114-v1/stage2.json'
 manifest={'exploratory':True,'label':'Exploratory — previously observed evaluation deck set','protocol_sha256':sha(OUT/'exploratory-20m-manifest.json'),'controls':controls,'opponents':{k:None if p is None else {'path':str(p),'sha256':sha(p)} for k,p in opponents.items()},'tactical_bank':str(bank),'tactical_sha256':sha(bank),'jobs':jobs,'source':provenance(),'budget_seconds':36000,'B3':'not run','prohibited_access':['21M','22M','reserved bank','unrelated confirmation probes']}
 for name in manifest['source']['source_hashes']:
  target=OUT/'source-snapshot'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,target)
 write(OUT/'experiment-manifest.json',manifest)
 (OUT/'README.md').write_text('# Campaign5\n\nExploratory 20M previously-observed decks only. Stage1 evaluates nine existing finals before twelve new runs. No B0/B2 retraining. Status in status.json. The ten-hour deadline includes evaluation, tests/pilots and reporting; partial runs stay resumable.\n')

def metrics(games):
 d=result_metrics(games);n=len(games)
 d.update({k+'_rate':d[field]/n for k,field in [('win','wins'),('draw','draws'),('loss','losses')]});d.update(mean_plies=statistics.mean(g['plies'] for g in games),median_plies=statistics.median(g['plies'] for g in games),invalid_games=0,errors=0)
 return d

def tactical(t,seed,path,bank):
 dest=OUT/'tactical'/f'{t}-{seed}.json'
 if dest.exists():
  d=json.loads(dest.read_text());assert d['sha256']==sha(path);return d
 model,_=load_checkpoint(path);obs=[o for r in bank for o in [r['observation'],r['rotated']]]
 x=torch.from_numpy(np.stack([encode(o) for o in obs]));m=torch.from_numpy(mask_array(obs))
 with torch.inference_mode():probs=torch.cat([model(a,b)[0].probs for a,b in zip(x.split(128),m.split(128))]).numpy()
 rows=[]
 for i,r in enumerate(bank):
  targets=r['labels']['wins' if r['category']=='win' else 'safe'];p,q=probs[2*i:2*i+2];legal=r['observation']['legal'];rot=rotate_ids(legal)
  values=[]
  for distribution,ids in [(p,np.asarray(targets)),(q,rotate_ids(targets))]:
   assert len(ids)>0
   values.append({'mass':float(distribution[ids].sum()),'top1':int(int(distribution.argmax()) in ids),'rank':int(1+(distribution>distribution[ids].max()).sum())})
  rows.append({'id':r['id'],'category':r['category'],'mass':statistics.mean(v['mass'] for v in values),'top1':statistics.mean(v['top1'] for v in values),'best_rank':statistics.mean(v['rank'] for v in values),'rotation_tv':float(.5*np.abs(p[legal]-q[rot]).sum())})
 d={'treatment':t,'seed':seed,'sha256':sha(path),'positions':rows,'summary':{cat:{k:statistics.mean(r[k] for r in rows if r['category']==cat) for k in ['mass','top1','best_rank','rotation_tv']} for cat in ['win','defense']}}
 write(dest,d);return d

def contrasts(reports,pairs):
 rows=[]
 for a,b in pairs:
  for seed in SEEDS:
   for op in ['random','historical','intel']:
    aa=reports.get((a,seed,op));bb=reports.get((b,seed,op))
    if not aa or not bb:continue
    delta=paired_difference({int(k):v for k,v in bb['pair_scores'].items()},{int(k):v for k,v in aa['pair_scores'].items()})
    rows.append({'comparison':a+'-'+b,'seed':seed,'opponent':op,'score_difference':delta['difference'],'bootstrap_low':delta['bootstrap95'][0],'bootstrap_high':delta['bootstrap95'][1], 'win_rate_difference':aa['metrics']['win_rate']-bb['metrics']['win_rate'],'loss_rate_difference':aa['metrics']['loss_rate']-bb['metrics']['loss_rate'],'draw_rate_difference':aa['metrics']['draw_rate']-bb['metrics']['draw_rate'],'no_progress_difference':aa['metrics']['no_progress_rate']-bb['metrics']['no_progress_rate']})
 return rows

def report(reports,tactics,stage1=False):
 pairs=[('B1','B0'),('B2','B0'),('B2','B1')] if stage1 else [('C1-L90','B0'),('C1-L85','B0'),('C1-L85','C1-L90'),('C2-R50','B2'),('C2-R70','B2'),('C2-R70','C2-R50'),('C2-R50','B0'),('C2-R70','B0')]
 effects=contrasts(reports,pairs);write(OUT/('stage1-effects.json' if stage1 else 'per-seed-effects.json'),effects)
 lines=['# '+('Stage1 Campaign4B' if stage1 else 'Campaign5')+' exploratory evaluation','','Previously observed 20M decks; not fresh confirmation. Three training seeds are the learning replication units. All models use normal full-game starts. No test-score-based stopping or checkpoint selection.','','| Treatment | Opponent | Mean score | W/D/L totals | NO_PROGRESS |','|---|---|---:|---|---:|']
 treatments=['B0','B1','B2'] if stage1 else ['B0','B2',*MATRIX]
 for t in treatments:
  for op in ['random','historical','intel']:
   rs=[r for (tt,ss,oo),r in reports.items() if tt==t and oo==op]
   if len(rs)!=3:continue
   lines.append(f"|{t}|{op}|{statistics.mean(r['metrics']['score'] for r in rs):.2%}|"+'/'.join(str(sum(r['metrics'][key] for r in rs)) for key in ['wins','draws','losses'])+f"|{statistics.mean(r['metrics']['no_progress_rate'] for r in rs):.2%}|")
 lines+=['','## Matched-seed score differences (percentage points)','','| Contrast | Opponent | Seed differences | Mean | Exploratory seed t95 |','|---|---|---|---:|---|']
 for a,b in pairs:
  for op in ['random','historical','intel']:
   vs=[r['score_difference'] for r in effects if r['comparison']==a+'-'+b and r['opponent']==op]
   if len(vs)!=3:continue
   mean=statistics.mean(vs);rad=4.30265273*statistics.stdev(vs)/np.sqrt(3)
   lines.append(f"|{a}-{b}|{op}|{', '.join(f'{100*v:+.2f}' for v in vs)}|{100*mean:+.2f}|[{100*(mean-rad):+.2f}, {100*(mean+rad):+.2f}]|")
   lines.append('') if False else None
 lines+=['','Intervals are exploratory, unadjusted, fragile at n=3; containing zero is not proof of equivalence. Compare win and loss changes in per-seed records, not draw reduction alone. Cross-group C1 vs C2 is not a single-factor comparison. Tactical comparisons are conditional on the explored fully-revealed <=6-piece distribution. Mechanisms (critic quality, representation, hidden-information uncertainty) remain causally unresolved.']
 lines += ['', '## Tactical evidence (orientation-mean; explored bank only)', '', '|Treatment|Win mass|Win top1|Best win rank|Defense mass|Defense top1|Win TV|', '|---|---:|---:|---:|---:|---:|---:|']
 for t in treatments:
  ts=[v['summary'] for (tt,ss),v in tactics.items() if tt==t]
  if len(ts)==3:
   avg=lambda cat,k:statistics.mean(v[cat][k] for v in ts)
   lines.append(f"|{t}|{avg('win','mass'):.4f}|{avg('win','top1'):.4f}|{avg('win','best_rank'):.2f}|{avg('defense','mass'):.4f}|{avg('defense','top1'):.4f}|{avg('win','rotation_tv'):.4f}|")
 lines += ['', '## Replication and generalization findings', '']
 for a,b in pairs:
  consistent=[]
  for op in ['random','historical','intel']:
   values=[r['score_difference'] for r in effects if r['comparison']==a+'-'+b and r['opponent']==op]
   if len(values)==3 and all(v>0 for v in values):consistent.append(op)
  lines.append(f"- {a} vs {b}: positive score point differences in all three seeds against: {', '.join(consistent) if consistent else 'none'}. This is exploratory point consistency, not a confirmatory superiority claim. W/D/L decomposition and intervals must agree before recommending a direction.")
 lines += ['', 'Observed: all listed normal-start game records and tactical metrics. Conditionally supported: only consistent matched effects under these explored opponents/positions. Unsupported: any claimed global optimum or an unobserved B3 gain. Untested: search, new representations and expert learning. Causally unresolved: critic calibration mechanism, learning per terminal outcome, and whether higher archive reuse itself causes negative transfer.']
 (OUT/('stage1-campaign4b-evaluation.md' if stage1 else 'research-synthesis.md')).write_text('\n'.join(lines)+'\n')
 if not stage1:
  csvwrite(OUT/'c1-lambda-comparison.csv',[r for r in effects if r['comparison'].startswith('C1')]);csvwrite(OUT/'c2-restart-density-comparison.csv',[r for r in effects if r['comparison'].startswith('C2')])
 # Position-paired bootstrap, keeping seed identities separate.
 td=[]
 for a,b in pairs:
  for seed in SEEDS:
   if (a,seed) not in tactics or (b,seed) not in tactics:continue
   x=tactics[a,seed]['positions'];y=tactics[b,seed]['positions'];assert [r['id'] for r in x]==[r['id'] for r in y]
   for cat in ['win','defense']:
    for key in ['mass','top1','best_rank','rotation_tv']:
     v=np.array([r[key]-s[key] for r,s in zip(x,y) if r['category']==cat]);ix=np.random.default_rng(19).integers(len(v),size=(4000,len(v)));ci=np.quantile(v[ix].mean(1),[.025,.975]);td.append({'comparison':a+'-'+b,'seed':seed,'category':cat,'metric':key,'mean':float(v.mean()),'bootstrap95':ci.tolist()})
 write(OUT/('stage1-tactical-effects.json' if stage1 else 'tactical-effects.json'),td)


def run():
 lock=(OUT/'execution.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 manifest=json.loads((OUT/'experiment-manifest.json').read_text());start=manifest.get('execution_started_epoch',time.time());deadline=start+36000
 if (OUT/'status.json').exists():raise FileExistsError('Inspect existing campaign before recovery')
 state={'phase':'stage1','supervisor_pid':os.getpid(),'started_epoch':start,'deadline_epoch':deadline,'matchups_completed':0,'jobs':manifest['jobs']};write(OUT/'status.json',state)
 for name,digest in manifest['source']['source_hashes'].items():assert sha(ROOT/name)==digest,name
 os.environ['AI7_ARTIFACT_ROOT']=str(OUT)
 os.environ['AI7_ARTIFACT_LIMIT_BYTES']=str(50_000_000_000)
 seed_all(19,2);protocol=json.loads((OUT/'exploratory-20m-manifest.json').read_text());bank=json.loads(Path(manifest['tactical_bank']).read_text())['bank'];assert len(bank)==400
 opponents={k:None if meta is None else load_checkpoint(Path(meta['path']))[0] for k,meta in manifest['opponents'].items()}
 reports={};tactics={};bridge=Bridge(OUT/'evaluation-ipc')
 child=None
 def stop(sig,_):
  if child and child.poll() is None:os.killpg(child.pid,sig)
  raise KeyboardInterrupt('Campaign stopped')
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 def evaluate(t,seed,path,stage):
  assert time.time()<deadline
  model,ck=load_checkpoint(path);assert ck['env_steps']==3640000 and ck['config']['seed']==seed
  for op in opponents:
   dest=OUT/'evaluations'/f'{t}-{seed}-{op}.json';identity={'model':sha(path),'opponent':manifest['opponents'][op],'protocol':manifest['protocol_sha256']}
   if dest.exists():r=json.loads(dest.read_text());assert r['identity']==identity
   else:
    state.update(active=f'{t}-{seed}',active_opponent=op);write(OUT/'status.json',state)
    r=evaluate_checkpoint(bridge,model,'final',protocol['decks'],op,opponents[op],archive_count=0,deadline=time.perf_counter()+max(0,deadline-time.time()))
    assert len(r['games'])==512 and {(g['seed'],g['seat']) for g in r['games']}=={(d,s) for d in protocol['decks'] for s in [0,1]}
    r.update(identity=identity,metrics=metrics(r['games']),treatment=t,seed=seed,exploratory=True);write(dest,r)
   reports[t,seed,op]=r;state['matchups_completed']+=1;write(OUT/'status.json',state)
   with (OUT/(stage+'-per-game-results.jsonl')).open('a') as f:
    for g in r['games']:f.write(json.dumps({'treatment':t,'training_seed':seed,'opponent':op,**g})+'\n')
  tactics[t,seed]=tactical(t,seed,path,bank)
 try:
  for c in manifest['controls']:assert sha(Path(c['path']))==c['sha256'];evaluate(c['treatment'],c['seed'],Path(c['path']),'stage1')
  report(reports,tactics,True)
  state['phase']='training';write(OUT/'status.json',state)
  for j in state['jobs']:
   if time.time()>deadline-180:break
   if shutil.disk_usage(ROOT).free<30*1024**3:raise RuntimeError('Disk headroom below 30 GiB')
   commandline=[sys.executable,'-m','scripts.ai7.train',*j['args'],'--deadline-epoch',str(deadline-120)]
   j.update(status='running',started_epoch=time.time(),command=commandline);write(OUT/'status.json',state)
   before=resource.getrusage(resource.RUSAGE_CHILDREN)
   with (OUT/(j['id']+'.log')).open('x') as f:
    child=subprocess.Popen(commandline,cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
    j['pid']=child.pid;write(OUT/'status.json',state)
    try:code=child.wait(timeout=max(1,deadline-time.time()-60))
    except subprocess.TimeoutExpired:
     os.killpg(child.pid,signal.SIGTERM)
     try:code=child.wait(timeout=30)
     except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait()
   after=resource.getrusage(resource.RUSAGE_CHILDREN);j.update(cpu_seconds=after.ru_utime+after.ru_stime-before.ru_utime-before.ru_stime,wall_seconds=time.time()-j['started_epoch'])
   p=OUT/'runs'/j['id'];s=json.loads((p/'summary.json').read_text()) if (p/'summary.json').exists() else {};j.update(status=s.get('status','failed'),env_steps=s.get('env_steps',0),returncode=code)
   write(OUT/'status.json',state)
   if j['status']!='completed' or j['env_steps']!=3640000:continue
   j['final_sha256']=sha(p/'final.pt')
  state['phase']='stage5-evaluation';write(OUT/'status.json',state)
  for j in state['jobs']:
   if j['status']=='completed' and time.time()<deadline-120:evaluate(j['treatment'],j['seed'],OUT/'runs'/j['id']/'final.pt','stage5')
  report(reports,tactics)
  finish(manifest,state,reports,tactics)
  state['phase']='completed' if all(j['status']=='completed' for j in state['jobs']) and len(reports)==63 else 'partial';state['finished_epoch']=time.time();write(OUT/'status.json',state)
 except BaseException as e:
  state.update(phase='partial-or-failed',error=repr(e));write(OUT/'status.json',state);raise
 finally:bridge.close()


def finish(manifest,state,reports,tactics):
 rows=[]
 for c in manifest['controls']+[{**j,'path':str(OUT/'runs'/j['id']/'final.pt')} for j in state['jobs'] if j['status']=='completed']:
  p=Path(c['path']).parent;s=json.loads((p/'summary.json').read_text());games=[json.loads(x) for x in (p/'training-games.jsonl').read_text().splitlines()];sam=s['restart_sampler'];dec=sum(g['return']!=0 for g in games);length=[g.get('continuation_plies',g['plies']) for g in games]
  row={'treatment':c['treatment'],'seed':c['seed'],'steps':s['env_steps'],'completed':len(games),'terminals_per_million':len(games)/3.64,'decisive_per_million':dec/3.64,'mean_continuation':statistics.mean(length),'median_continuation':statistics.median(length),'normal_starts':sam['normal_starts'],'restart_starts':sam['restart_starts'],'restart_fraction':sam['restart_starts']/(sam['normal_starts']+sam['restart_starts']),'restart_transition_share':s.get('restart_start_transitions',None)/s['env_steps'] if 'restart_start_transitions' in s else None,'distinct_archive_records':len(sam['frequencies']),'optimizer_steps':s['optimizer_steps'],'ppo_updates':s['updates'],'training_seconds':s['actual_training_seconds'],'no_progress':sum(g['result']['reason']=='NO_PROGRESS' for g in games),'wins':sum(g['return']==1 for g in games),'draws':sum(g['return']==0 for g in games),'losses':sum(g['return']==-1 for g in games)}
  with (p/'metrics.jsonl').open() as f:row['learner_samples']=sum(json.loads(line)['learner_samples'] for line in f)
  rows.append(row)
 csvwrite(OUT/'run-inventory.csv',rows);write(OUT/'training-experience.json',rows)
 for name,body in {'terminal-density-analysis.md':'Terminal counts and decisive outcomes per transition are in run-inventory.csv. Restart transition share is measured including incomplete trajectories for new runs; historical B2 did not save that metric and remains null. Counts are not playing strength.', 'training-efficiency-analysis.md':'Use learner samples, optimizer steps, PPO updates and wall time separately. Shorter episodes are not automatically sample-efficient. Full training metrics preserve entropy, KL, clip fraction, value loss and advantage summaries; no missing gradients reconstructed.', 'tactical-transfer-analysis.md':'See tactical/*.json and tactical-effects.json for final-model probabilities, top1, rank, TV and paired-position bootstrap differences. Only explored Stage2 positions were used.', 'statistical-limitations.md':'20M is previously observed. Three matched training seeds, no multiplicity correction; deck bootstrap is conditional on fixed models. Position rotations are paired. Validation is not independent. No global optimum or causal critic mechanism inferred.', 'next-research-decision.md':'Read research-synthesis.md with per-seed-effects.json. Prioritize replication of effects consistent across seeds and opponents; if no robust restart transfer, reconsider representation/opponent distribution/advantage estimation rather than escalating restart density. Critic-quality causality and partial-observation search are untested. No new experiment automatically follows.'}.items():(OUT/name).write_text('# '+name.replace('.md','')+'\n\n'+body+'\n')
 for filename in ['terminal-density-analysis.md','training-efficiency-analysis.md']:
  with (OUT/filename).open('a') as f:
   f.write('\n|Treatment|Terminals/1M|Decisive/1M|Continuation mean|Restart start fraction|Learner samples|Optimizer steps|\n|---|---:|---:|---:|---:|---:|---:|\n')
   for t in ['B0','B2',*MATRIX]:
    rr=[r for r in rows if r['treatment']==t]
    if rr:
     avg=lambda k:statistics.mean(x[k] for x in rr)
     f.write(f"|{t}|{avg('terminals_per_million'):.1f}|{avg('decisive_per_million'):.1f}|{avg('mean_continuation'):.1f}|{avg('restart_fraction'):.3f}|{avg('learner_samples'):.0f}|{avg('optimizer_steps'):.0f}|\n")
 with (OUT/'next-research-decision.md').open('a') as f:
  effects=contrasts(reports,[('C1-L90','B0'),('C1-L85','B0'),('C2-R50','B2'),('C2-R70','B2')]);supported=[]
  for t in MATRIX:
   relevant=[r for r in effects if r['comparison'].startswith(t+'-')]
   if len(relevant)==9 and all(r['score_difference']>0 for r in relevant):supported.append(t)
  f.write('\nAll-three-seed positive point differences against all three opponents: '+(', '.join(supported) if supported else 'none')+'.\n')
  f.write('Highest priority: '+('independent confirmation of these candidate effects, keeping the same single-factor controls.' if supported else 'diagnose shared representation/opponent distribution and critic calibration before escalating restart density; no tested direction established robust superiority by this strict point-consistency screen.')+' This screen is descriptive and not proof of equivalence or significance.\n')
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 fig,ax=plt.subplots(figsize=(9,4))
 for t in ['B0','B2',*MATRIX]:
  r=[x for x in rows if x['treatment']==t]
  if r:ax.scatter([x['terminals_per_million'] for x in r],[x['decisive_per_million'] for x in r],label=t)
 ax.set_xlabel('Completed terminals / million transitions');ax.set_ylabel('Decisive outcomes / million transitions');ax.legend();fig.tight_layout();fig.savefig(OUT/'terminal-density.png');plt.close(fig)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['prepare','run']);a=parser.parse_args();prepare() if a.mode=='prepare' else run()
