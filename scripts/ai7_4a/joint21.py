"""Explicit joint-authorized 21M ONLY evaluation. No training/calibration/tactical entry."""
from pathlib import Path
import os,json,time,datetime,zoneinfo,itertools,statistics,csv,fcntl
import numpy as np
import torch
from scripts.ai7 import runtime
from scripts.ai7.evaluate import evaluate_checkpoint,paired_difference
from scripts.ai7.evaluate_shared import result_metrics
from scripts.ai7.shared_protocol import sha256
from scripts.ai7_export_cli import sampling_trace
from scripts.ai7_p0.common import paired_statistics
from scripts.ai7_4a.campaign import CAMPAIGN as C,ROOT,P0,OLD,atomic,read,EFFECTS

OUT=C/'joint-21m-evaluation-20261117-v1'
EXPECTED='a890517417e4828b32aaa1089e5d4375831c9d8e9ccd451a879e6f921c3f1592'
def now():return datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Taipei')).isoformat()
def require(ok,message):
 if not ok:raise RuntimeError('MATERIAL GATE FAILURE: '+message)

def gates():
 require(sha256(C/'shared-evaluation-manifest.json')==EXPECTED,'manifest SHA')
 manifest=read(C/'shared-evaluation-manifest.json');cfg=read(C/'config.json')
 require(manifest['deck_seeds']==list(range(21000000,21000256)) and manifest['seats']==[0,1],'deck/seat ids')
 require(manifest['score']=={'WIN':1,'DRAW':.5,'LOSS':0},'score')
 require(manifest['evaluator']['batch_games']==16 and manifest['evaluator']['device']=='cpu' and manifest['evaluator']['torch_threads']==2,'execution settings')
 for n,h in cfg['source_hashes'].items():require(sha256(ROOT/n)==h,'preregistered source '+n)
 for n,h in manifest['evaluator']['source_sha256'].items():require(sha256(ROOT/n)==h,'evaluator source '+n)
 for n in ['games','calibration-reference.npz','calibration-reference.json','calibration-results.json']:
  require(not (C/n).exists(),'unexpected pre-existing canonical result '+n)
 require(not (OUT/'games').exists(),'new-output games already exist before preregistration')
 runtime.seed_all(19,2)
 paths={'m1_exp2_baseline_4023':P0/'imports/intel-evaluation-bundle/historical-opponent/baseline-seed-4023-step-3640000.pt',
        'intel_gae095_seed6011':OLD/'runs/gae_lambda_095-seed-6011/final.pt'}
 opponents={};identities=[]
 require([r['name'] for r in manifest['opponents']]==['random','m1_exp2_baseline_4023','intel_gae095_seed6011'],'opponent order/definitions')
 for name,p in paths.items():
  expected=next(r['checkpoint_sha256'] for r in manifest['opponents'] if r['name']==name)
  require(sha256(p)==expected,'opponent SHA '+name)
  model,meta=runtime.load_checkpoint(p)
  require(meta['model_config']=={'architecture':'baseline','input_dim':2163,'width':128} and meta['env_steps']==3640000,'opponent architecture/endpoint')
  opponents[name]=model;identities.append({'name':name,'path':str(p),'sha256':expected,'model_config':meta['model_config'],'observation_version':meta['observation_version'],'core_revision':meta['core_revision']})
 require(manifest['opponents'][0]['implementation_sha256']==sha256(ROOT/'scripts/ai7/runtime.py'),'uniform random implementation')
 finals=[r for r in read(C/'checkpoint-index.json') if r['endpoint']=='final']
 require(len(finals)==12 and {(r['treatment'],r['seed']) for r in finals}=={(m,s) for m in ['A0','A1','A2','A3'] for s in [7011,7023,7037]},'12 matched final identities')
 for cp in finals:
  require(sha256(cp['path'])==cp['sha256'],'final SHA '+cp['id'])
  model,meta=runtime.load_checkpoint(cp['path'])
  require(meta['env_steps']==3640000 and meta['config']['seed']==cp['seed'],'final endpoint/seed')
  require(meta['config']['campaign4a_treatment']==cp['treatment'],'treatment identity')
  require(meta['model_config']=={'architecture':'baseline','input_dim':2163,'width':128},'final architecture')
  require(meta['config']['gae_lambda']==(.95 if cp['treatment'] in ['A0','A1'] else .8),'lambda')
  require(meta['config']['extra_critic']==(cp['treatment'] in ['A1','A3']),'extra critic flag')
 fixture_root=ROOT/'benchmark-results/ai7-selfplay/exports/m1-common-evaluation/ai7-intel-to-m1-evaluation-protocol/evaluation/validation-fixtures'
 fixture=read(fixture_root/'public-position.json');obs=[fixture['observation'],fixture['rotated']]
 masks=runtime.mask_array(obs)
 with torch.inference_mode():actual=opponents['m1_exp2_baseline_4023'](torch.from_numpy(np.stack([runtime.encode(o) for o in obs])),torch.from_numpy(masks))[0].probs.numpy()
 with np.load(fixture_root/'m1-reference.npz',allow_pickle=False) as reference:error=float(np.max(np.abs(actual-reference['probabilities'])))
 require(error<=1e-5 and not actual[~masks].any(),'M1 observation/policy/mask conformance')
 require(sampling_trace(runtime,opponents['m1_exp2_baseline_4023'],fixture['observation'])==read(fixture_root/'sampling-trace.json')['actions'],'PCG64 role stream / ordered legal categorical / Random trace')
 golden=read(fixture_root/'paired-bootstrap.json');pair=paired_difference(golden['baseline_pair_scores'],golden['treatment_pair_scores'])
 require(all(np.allclose(pair[k],golden['expected'][k],rtol=0,atol=1e-12) for k in ['difference','bootstrap95','hoeffding95']),'paired bootstrap kernel conformance')
 g={'passed':True,'at':now(),'manifest_sha256':EXPECTED,'final_checkpoints':finals,'opponents':identities,'registered_source_count':len(cfg['source_hashes']),
    'current_versions':{'torch':torch.__version__,'numpy':np.__version__},'M1_fixture_error':error,'RNG_fixture':'32 mocked choices, no complete game or new21M outcome','bootstrap_fixture':'passed','no22M':True}
 return manifest,finals,opponents,g

def analyze(reports):
 metrics=['score','win_rate','draw_rate','loss_rate','no_progress_rate','mean_plies'];rows=[]
 for report in reports:
  buckets={m:{} for m in metrics}
  for game in report['games']:
   result=game['result'];draw=result['type']=='DRAW';win=not draw and result['winner']==('P1' if game['seat']==0 else 'P2')
   vals=[1. if win else .5 if draw else 0.,float(win),float(draw),float(not win and not draw),float(result['reason']=='NO_PROGRESS'),float(game['plies'])]
   for metric,value in zip(metrics,vals):buckets[metric].setdefault(str(game['seed']),[]).append(value)
  report['_vectors']={m:{s:float(np.mean(v)) for s,v in buckets[m].items()} for m in metrics}
  require(all(len(v)==2 for v in buckets['score'].values()) and len(buckets['score'])==256,'paired game accounting')
 for opponent in ['random','m1_exp2_baseline_4023','intel_gae095_seed6011']:
  for seed in [7011,7023,7037]:
   by={r['checkpoint_identity']['treatment']:r for r in reports if r['opponent']==opponent and r['checkpoint_identity']['seed']==seed}
   for effect,weights in EFFECTS.items():
    for metric in metrics:
     vec=sum(w*np.array([by[m]['_vectors'][metric][str(s)] for s in range(21000000,21000256)]) for m,w in weights.items())
     stats=paired_statistics(vec,resamples=10000,seed=19)
     row={'opponent':opponent,'training_seed':seed,'effect':effect,'metric':metric,'difference':stats['mean'],'deck_bootstrap95':stats['percentile95'],
          'pairs':256,'resamples':10000,'bootstrap_seed':19,'unit':'deck pairs conditional on fixed trained models',
          'primary':opponent=='intel_gae095_seed6011' and effect=='extra_at_095' and metric=='score'}
     if effect=='extra_at_095' and metric=='score':
      exact=paired_difference(by['A0']['_vectors']['score'],by['A1']['_vectors']['score'])
      require(abs(exact['difference']-row['difference'])<1e-12 and np.allclose(exact['bootstrap95'],row['deck_bootstrap95']),'primary existing paired_difference consistency')
      row['existing_evaluator_paired_difference']=exact
     rows.append(row)
 replicated=[]
 for opponent,effect,metric in sorted({(r['opponent'],r['effect'],r['metric']) for r in rows}):
  subset=[r for r in rows if (r['opponent'],r['effect'],r['metric'])==(opponent,effect,metric)];v=[r['difference'] for r in subset]
  mean=statistics.mean(v);radius=4.302652729911275*statistics.stdev(v)/np.sqrt(3)
  replicated.append({'opponent':opponent,'effect':effect,'metric':metric,'seed_ids':[r['training_seed'] for r in subset],'seed_effects':v,'mean':mean,
                     'paired_training_seed_t95':[float(mean-radius),float(mean+radius)],'n':3,
                     'primary':opponent=='intel_gae095_seed6011' and effect=='extra_at_095' and metric=='score',
                     'qualification':'Paired trained-seed effects, exploratory n3 normality assumption; secondary intervals unadjusted; not 768 training replications'})
 primary=next(r for r in replicated if r['primary'])
 primary['conclusion']='positive score evidence under preregistered exploratory criterion' if primary['paired_training_seed_t95'][0]>0 else 'negative score evidence under exploratory criterion' if primary['paired_training_seed_t95'][1]<0 else 'inconclusive at trained-seed level'
 data={'primary':primary,'per_seed_contrasts':rows,'paired_training_seed_effects':replicated,'games':18432,'matchups':36,
       'primary_endpoint':'Final3.64M A1-A0 score vs frozen Intel GAE095 seed6011','no22M':True}
 atomic(OUT/'paired-analysis.json',data)
 with (OUT/'paired-analysis.csv').open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0].keys())+['existing_evaluator_paired_difference']);w.writeheader();w.writerows(rows)
 lines=['# Campaign4A Joint21M evaluation', '\nPrimary preregistered before21M: A1−A0, λ=.95, score vs frozen Intel GAE0956011, fixed final3.64M.','\n## Primary paired-training-seed result',
        '\n'+json.dumps(primary,ensure_ascii=False,indent=2),'\nDeck bootstrap intervals are conditional on each fixed checkpoint pair; training-seed t95 uses n3 paired effects. Secondary comparisons are exploratory/unadjusted. No claim of universal mechanism or winning conversion from score alone.',
        '\n## W/D/L and terminal outcomes','\n| Model | Opponent | W/D/L | Score | NO_PROGRESS | Mean plies |','| --- | --- | --- | --- | --- | --- |']
 for r in reports:lines.append(f"| {r['checkpoint_identity']['id']} | {r['opponent']} | {r['wins']}/{r['draws']}/{r['losses']} | {r['score']:.5f} | {r['terminal_reason_counts']['NO_PROGRESS']} | {r['mean_plies']:.2f} |")
 lines+=['\nAll 18432 official outcomes recorded. Calibration22M and reserved tactical data were not accessed. Old20M and previously explored tactical results were not pooled into21M. Full secondary factorial results are in paired-analysis.json.']
 (OUT/'evaluation-report.md').write_text('\n'.join(lines)+'\n')
 return data

def main():
 OUT.mkdir(parents=True,exist_ok=False)
 lock=(C/'supervisor.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 state={'state':'preflight','at':now(),'pid':os.getpid(),'completed_matchups':0,'completed_games':0}
 atomic(OUT/'status.json',state)
 try:
  manifest,finals,opponents,g=gates();atomic(OUT/'preflight-validation.json',g)
  reconciliation={'at':now(),'provenance':'Explicit user-reviewed joint audit attestation in this conversation, not independently fetched M1 raw audit',
    'Intel_audit':{'path':str(ROOT/'benchmark-results/ai7-selfplay/inventory-audit-20261117-intel/evaluation-inventory-audit.json'),'sha256':sha256(ROOT/'benchmark-results/ai7-selfplay/inventory-audit-20261117-intel/evaluation-inventory-audit.json')},
    'joint_findings':{'Intel21M':'MANIFEST_ONLY','Intel22M':'MANIFEST_ONLY','M1_21M':'MANIFEST_ONLY','M1_22M':'MANIFEST_ONLY','manifest_sha256_both':EXPECTED,'execution_exposure_training_contamination':'No evidence within both audited scopes','M1_4B_finals':'six verified by M1 per user-reviewed attestation','Intel4A_finals':'12 verified locally','Campaign5':'used explored20M, not21M'},
    'limitations':'Inherited audit scope gaps remain; no claim of absolute global UNUSED; M1 raw audit file/SHA not transferred here; user joint authorization accepted',
    'authorization':'User explicitly authorizes21M after gates, prohibits training,22M,model changes,reserved tactical bank,commits,pushes'}
  atomic(OUT/'joint-audit-reconciliation.json',reconciliation)
  prereg={'frozen_at':now(),'manifest_sha256':EXPECTED,'runner_sha256':sha256(Path(__file__)),
    'primary':{'contrast':'A1-A0','lambda':.95,'metric':'official score','opponent':'intel_gae095_seed6011','training_seeds':[7011,7023,7037],
      'checkpoint':'fixed final3640000','unit':'paired training seed n3','analysis':'mean of 3 matched trained-seed differences; two-sided t95 df2, critical4.302652729911275; positive evidence if lower bound>0; otherwise report inconclusive/negative, exploratory small-n',
      'conditional_analysis':'each training-seed paired256deck bootstrap10000 draws seed19; both seats averaged first; existing paired_difference kernel'},
    'secondary':{'contrasts':EFFECTS,'metrics':['score','win_rate','draw_rate','loss_rate','no_progress_rate','mean_plies'],'opponents':['random','m1_exp2_baseline_4023','intel_gae095_seed6011'],'multiplicity':'unadjusted exploratory'},
    'games':18432,'matchups':36,'decks':manifest['deck_seeds'],'seats':[0,1],'opponents':g['opponents'],'finals':finals,
    'RNG':manifest['sampling'],'evaluator':manifest['evaluator'],'score':manifest['score'],'no_training':True,'no22M':True,'no_tactical':True,
    'prior_exposure':'20M and Stage2 tactical diagnostics previously explored; this primary choice is frozen before any new21M outcome, not retroactively claimed as preregistration of all earlier analyses'}
  atomic(OUT/'preregistration.json',prereg)
  (OUT/'preregistration.md').write_text('# Joint21M preregistration\n\n'+json.dumps(prereg,ensure_ascii=False,indent=2)+'\n')
  (OUT/'shared-evaluation-manifest.json').write_bytes((C/'shared-evaluation-manifest.json').read_bytes())
  atomic(OUT/'freeze.json',{'at':now(),'preregistration_sha256':sha256(OUT/'preregistration.json'),'reconciliation_sha256':sha256(OUT/'joint-audit-reconciliation.json'),'manifest_sha256':EXPECTED,'all_gates_passed':True,'outcomes_observed_before_freeze':False})
  os.environ.update(AI7_ARTIFACT_ROOT=str(OUT),AI7_DISK_HEADROOM='3000000000')
  runtime.seed_all(19,2);reports=[];expected={(s,seat) for s in manifest['deck_seeds'] for seat in [0,1]}
  state.update(state='evaluating21M',explicit_start_at=now());atomic(OUT/'status.json',state)
  bridge=runtime.Bridge(OUT/'ipc')
  atomic(OUT/'runtime-metadata.json',bridge.metadata)
  try:
   for cp in finals:
    for opp in manifest['opponents']:
     name=opp['name'];model,meta=runtime.load_checkpoint(cp['path'])
     require(sha256(cp['path'])==cp['sha256'],'checkpoint before matchup')
     r=evaluate_checkpoint(bridge,model,'final',manifest['deck_seeds'],name,opponents.get(name),archive_count=0,batch_games=16)
     require(len(r['games'])==512 and {(x['seed'],x['seat']) for x in r['games']}==expected,'complete512 paired identities')
     require(r['attempted']==512 and r['skipped']==0 and r['incomplete']==0,'no incomplete/errors')
     for game in r['games']:
      result=game['result'];win=result['type']=='WIN' and result['winner']==('P1' if game['seat']==0 else 'P2')
      expected_return=0 if result['type']=='DRAW' else 1 if win else -1
      require(game['return']==expected_return,'Core outcome/reward perspective')
     r.update(result_metrics(r['games']));r.update(checkpoint_identity=cp,opponent_identity=opp,manifest_sha256=EXPECTED,errors=0)
     atomic(OUT/'games'/f"{cp['id']}-vs-{name}.json",r);reports.append(r)
     state.update(completed_matchups=len(reports),completed_games=512*len(reports),active_model=cp['id'],opponent=name,updated_at=now());atomic(OUT/'status.json',state)
     print(json.dumps(state),flush=True)
  finally:bridge.close()
  require(len(reports)==36,'all36 matchups')
  state['state']='analysis';atomic(OUT/'status.json',state);analyze(reports)
  for cp in finals:require(sha256(cp['path'])==cp['sha256'],'final post-evaluation SHA')
  for opp in g['opponents']:require(sha256(opp['path'])==opp['sha256'],'opponent post-evaluation SHA')
  require(not (C/'calibration-reference.npz').exists() and not (C/'calibration-results.json').exists(),'22M remained absent')
  with (OUT/'per-game-records.jsonl').open('w') as stream:
   for r in reports:
    for game in r['games']:stream.write(json.dumps({'model':r['checkpoint_identity']['id'],'checkpoint_sha256':r['checkpoint_identity']['sha256'],'opponent':r['opponent'],'manifest_sha256':EXPECTED,'game':game})+'\n')
  atomic(OUT/'validation.json',{'passed':True,'matchups':36,'games':18432,'unique_decks_per_matchup':256,'seats':[0,1],'all_outcomes_recomputed_from_Core':True,'all_model_and_opponent_hashes_unchanged':True,'no_training':True,'no22M':True,'reserved_access':False})
  state.update(state='completed',finished_at=now());atomic(OUT/'status.json',state)
  hashes={str(p.relative_to(OUT)):sha256(p) for p in OUT.rglob('*') if p.is_file() and p.name!='checksums.json'};atomic(OUT/'checksums.json',hashes)
 except BaseException as e:
  state.update(state='STOPPED_material_mismatch_or_execution_failure',error=repr(e),at=now());atomic(OUT/'status.json',state);raise

if __name__=='__main__':main()
