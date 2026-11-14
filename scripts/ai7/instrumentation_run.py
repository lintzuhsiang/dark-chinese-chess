"""Phase-one sequential controlled instrumentation validation, not tuning."""
import json,os,subprocess,sys,time,hashlib
from pathlib import Path
import numpy as np
from .runtime import ROOT,write_json,provenance,artifact_bytes


def report(root):
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 state=json.loads((root/'run-status.json').read_text()); results=[]
 fig,axes=plt.subplots(1,3,figsize=(15,4),constrained_layout=True)
 for run in state['runs']:
  path=root/'runs'/str(run['seed']);file=path/'metrics.jsonl'
  rows=[json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []
  ds=[m for m in rows if 'diagnostics' in m]; grads=[g for m in ds for g in m['diagnostics']['gradients']]
  events=[]
  for m in ds:
   for p in m['diagnostics']['probes']:
    if 'immediate_win' in p['groups']:
     g=p['groups']['immediate_win'];events.append({'update':m['update'],'steps':m['env_steps'],'probe':p['id'],'before':g['before'],'after':g['after'],'delta':g['after']-g['before'],'kl':p['kl_before_after']})
  def series(key):
   return [np.mean([p['groups'][key]['after'] for p in m['diagnostics']['probes'] if key in p['groups']]) for m in ds]
  xs=[m['env_steps'] for m in ds]
  if ds:
   axes[0].plot(xs,series('immediate_win'),label=str(run['seed']))
   axes[1].plot(xs,[np.mean([p['kl_before_after'] for p in m['diagnostics']['probes']]) for m in ds],label=str(run['seed']))
   axes[2].plot(xs,[m['diagnostics']['advantages']['by_outcome']['0']['decision_fraction'] for m in ds],label=str(run['seed']))
  cosine=[g['shared_actor_critic_cosine'] for g in grads if g['shared_actor_critic_cosine'] is not None]
  result={'seed':run['seed'],'state':run['state'],'steps':rows[-1]['env_steps'] if rows else 0,'instrumented_updates':len(ds),'sampled_minibatches':len(grads),
    'gradient_conflict_fraction':float(np.mean(np.array(cosine)<0)) if cosine else None,
    'max_component_sum_error':max([g['component_sum_max_abs_error'] for g in grads],default=None),
    'max_outcome_sum_error':max([g['outcome_sum_max_abs_error'] for g in grads],default=None),
    'max_post_clip_norm':max([g['actual_post_clip_norm'] for g in grads],default=None),
    'largest_winning_probability_drops':sorted(events,key=lambda x:x['delta'])[:8]}
  if (path/'summary.json').exists():result['training_summary']=json.loads((path/'summary.json').read_text())
  results.append(result)
 write_json(root/'instrumentation-results.json',results)
 for ax,title in zip(axes,['Fixed-probe immediate win probability','Mean per-update fixed-probe KL','Draw trajectory share of learner decisions']):ax.set(title=title,xlabel='Environment transitions');ax.grid(alpha=.2);ax.legend()
 fig.savefig(root/'instrumentation-curves.png',dpi=150);plt.close(fig)
 lines=['# Phase 1 — Instrumentation validation','','This is a short diagnostic experiment, not a strength comparison. No reward, PPO hyperparameter, architecture, or rule was changed.','', '|Seed|State|Steps|Updates with diagnostics|Sampled gradient minibatches|Actor/critic opposing-gradient fraction|','|---|---|---:|---:|---:|---:|']
 for x in results:lines.append(f"|{x['seed']}|{x['state']}|{x['steps']}|{x['instrumented_updates']}|{x['sampled_minibatches']}|{x['gradient_conflict_fraction'] if x['gradient_conflict_fraction'] is not None else 'NA'}|")
 lines+=['','Full update diagnostics (advantage distributions, game/decision outcome proportions, probe before/after probabilities and KL, gradients) are committed inside each metrics.jsonl at the same rollback boundary as existing training records. No historical gradients were reconstructed.','', 'Gradient samples use the first minibatch of each epoch for updates1–10, then every10th update. Critic/entropy gradients include actual objective coefficients; outcome Actor contributions retain the full minibatch denominator and globally normalized advantages. Gradient directions are pre-Adam/pre-clipping diagnostics, not a causal decomposition of Adam parameter changes.','', 'All three fresh MLP runs retain gamma=lambda=1, lr3e-4, epochs4, clip.2, entropy.01, and original opponent probabilities. The overnight historical snapshot cadence910k is retained:500k ends before the first new historical snapshot. Thus this cannot rule out failures appearing only later or with richer historical opponents. Probe inputs, masks and initial probability references are fixed and checkpointed. Probes do not influence rewards, actions, model selection or stopping.','', 'Gate results and precise versions/source hashes are in config.json/source-provenance.json. Small-run timing is not a robust benchmark: compare only matched ON/OFF gates, not different training seeds.','', 'Negative Actor/Critic cosine and a simultaneous probe decrease are associations, not proof that Critic caused forgetting. Detailed minibatches are predetermined samples rather than all updates; missing samples must not be interpreted as no conflict. A short run without a failure does not falsify a long-horizon failure hypothesis.','']
 (root/'instrumentation-validation.md').write_text('\n'.join(lines))


def main():
 root=ROOT/'benchmark-results/ai7-selfplay/instrumentation-phase1/20261114-v1';root.mkdir(parents=True,exist_ok=False)
 os.environ['AI7_ARTIFACT_ROOT']=str(root);os.environ['MPLCONFIGDIR']='/tmp/ai7-phase1-matplotlib'
 gates=sorted((ROOT/'benchmark-results/ai7-selfplay/instrumentation-gates').glob('*/gate-result.json'))
 gate=json.loads(gates[-1].read_text());assert gate['passed']
 config={'seeds':[1011,2027,3037],'steps_per_seed':500000,'global_wall_seconds':1800,'artifact_cap_bytes':1000000000,'gate':gate,'instrumentation':'detailed','gradient_sampling':'updates1-10 then every10, first minibatch of each epoch','historical_snapshot_interval':910000}
 write_json(root/'config.json',config); source=provenance();write_json(root/'source-provenance.json',source)
 for name,digest in source['source_hashes'].items():
  data=(ROOT/name).read_bytes();assert hashlib.sha256(data).hexdigest()==digest
  target=root/'source-snapshot'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 state={'state':'running','started_epoch':time.time(),'runs':[{'seed':s,'state':'pending'} for s in config['seeds']]};deadline=time.time()+1800
 for run in state['runs']:
  if time.time()>deadline or artifact_bytes(root)>900000000:run['state']='skipped';continue
  run['state']='running';write_json(root/'run-status.json',state)
  command=[sys.executable,'-m','scripts.ai7.train','--output',str(root/'runs'/str(run['seed'])),'--seed',str(run['seed']),'--max-env-steps','500000','--checkpoint-every-steps','910000','--threads','2','--batch-games','16','--max-replays','2','--validation-pairs','8','--validation-seed-start','1200000','--instrumentation','detailed','--gradient-sample-every-updates','10','--training-seconds','900','--deadline-epoch',str(deadline)]
  with (root/f"seed-{run['seed']}.stdout.jsonl").open('w') as out,(root/f"seed-{run['seed']}.stderr.log").open('w') as err:
   result=subprocess.run(command,cwd=ROOT,env=os.environ,stdout=out,stderr=err,timeout=max(1,deadline-time.time()+15))
  run['returncode']=result.returncode
  summary=root/'runs'/str(run['seed'])/'summary.json'
  run['state']='completed' if result.returncode==0 and summary.exists() and json.loads(summary.read_text())['env_steps']==500000 else 'failed'
  write_json(root/'run-status.json',state);report(root);print(run,flush=True)
 state.update(state='completed' if all(r['state']=='completed' for r in state['runs']) else 'partial',elapsed_seconds=time.time()-state['started_epoch'],artifact_bytes=artifact_bytes(root));write_json(root/'run-status.json',state);report(root)
if __name__=='__main__':main()
