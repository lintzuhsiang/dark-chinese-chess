"""Predetermined extra analyses; no training or reserved-bank access."""
import argparse,json,subprocess,sys,collections,time
from pathlib import Path
import numpy as np
from .runtime import ROOT
from .campaign import atomic_json
from .research import seed_statistics

def main():
 p=argparse.ArgumentParser();p.add_argument('--campaign',type=Path,required=True);a=p.parse_args();c=a.campaign
 cfg=json.loads((c/'config.json').read_text());o=c/'analysis';o.mkdir(exist_ok=True)
 # Tactical checkpoint trajectories on the already-used, common 400-state bank.
 source=ROOT/'benchmark-results/ai7-selfplay/symmetry-audit/20261114-v1/stage2.json'
 if not (o/'stage2-evaluation.json').exists():
  (o/'stage2.json').write_bytes(source.read_bytes())
  subprocess.run([sys.executable,'-m','scripts.ai7.analysis.symmetry','--output',str(o),'--phase','stage2','--campaign',str(c)],check=True,timeout=300)
 # Replay a predetermined evenly-spaced sample of <=64 saved games per run.
 subprocess.run(['node','--import','./scripts/ai-eval/register.mjs','scripts/ai7/analysis/record_coverage.ts',str(o),str(c),'64'],check=True,timeout=600)
 coverage=json.loads((o/'replay-coverage.json').read_text())
 opportunities={(r['run'],r['game'],r['ply']):r for r in coverage['opportunities']}
 aligned=[];quiet=collections.defaultdict(lambda:[0,0.,0.,0])
 from .exp3_support import rotate_id
 for job in cfg['jobs']:
  with (c/'runs'/job['id']/'metrics.jsonl').open() as file:
   for line in file:
    m=json.loads(line);d=m.get('diagnostics',{});games=d.get('games',[])
    for row in d.get('decisions',[]):
     q='late40plus' if (row.get('quiet') or 0)>=40 else 'early0to39'
     bucket=quiet[(job['architecture'],str(row['outcome']),q)];bucket[0]+=1;bucket[1]+=row['raw_advantage'];bucket[2]+=row['normalized_advantage'];bucket[3]+=row['normalized_advantage']>0
     g=games[row['game_index']];key=(job['id'],g.get('archive'),row['ply']);op=opportunities.get(key)
     if not op:continue
     ids=[rotate_id(v) for v in op['targets']] if g.get('rotation') else op['targets']
     policy=dict(zip(row['legal'],row['old_legal_probabilities']))
     aligned.append({'run':job['id'],'archive':g['archive'],'ply':row['ply'],'update':m['update'],
      'category':op['category'],'selected':op['selected'],'old_target_probability':sum(policy[v] for v in ids),
      'old_value':row['old_value'],'raw_advantage':row['raw_advantage'],'normalized_advantage':row['normalized_advantage'],
      'outcome':row['outcome'],'full_minibatch_audit':d.get('gradient_sampling','').startswith('every'),
      'row':row['row'],'game_index':row['game_index']})
 atomic_json(o/'aligned-opportunities.json',aligned)
 atomic_json(o/'quiet-advantage.json',[{'treatment':k[0],'outcome':k[1],'quiet':k[2],'n':v[0],
    'raw_mean':v[1]/v[0],'normalized_mean':v[2]/v[0],'positive_fraction':v[3]/v[0]} for k,v in quiet.items()])
 rows=[]
 for job in cfg['jobs']:
  folder=c/'evaluations'/job['id'];summary=json.loads((folder/'summary.json').read_text())
  for m in summary['matchups']:rows.append({'run':job['id'],'seed':job['seed'],'treatment':job['architecture'],**m})
 atomic_json(o/'random-matchups.json',rows)
 lines=['# Experiment 3 M1 results','','Training seeds are independent replications; games and rotated probes are not. Partial runs are disclosed, not pooled as equal-budget results.','',
 '|Run|Checkpoint|W|D|L|Completed|','|---|---|---:|---:|---:|---:|']
 for r in rows:lines.append(f"|{r['run']}|{r['checkpoint']}|{r['wins']}|{r['draws']}|{r['losses']}|{r['completed']}|")
 lines+=['',f'Replayed {len(coverage["games"])} games; aligned {len(aligned)} learner opportunity decisions. This is a predetermined archive sample, not full-training coverage.', '',
 'See stage2-evaluation.json/md for all checkpoint trajectories, policy equivariance, symmetry gap, target probability, argmax accuracy/ranks and paired position intervals. See historical-evaluations for frozen opponents. Training draw penalties are evaluated with original W/D/L utility.']
 (o/'research-review.md').write_text('\n'.join(lines)+'\n')
 # Matched-seed comparisons vs new Baseline endpoint, standard evaluation utility.
 contrasts={}
 for treatment in cfg['architectures'][1:]:
  values=[]
  for seed in cfg['seeds']:
   def score(name):
    r=next(x for x in rows if x['treatment']==name and x['seed']==seed and x['checkpoint']=='final')
    return (r['wins']+.5*r['draws'])/r['completed'] if r['completed'] else None
   b=score('baseline');t=score(treatment)
   if b is not None and t is not None:values.append(t-b)
  contrasts[treatment]=seed_statistics(values)
 atomic_json(o/'matched-seed-contrasts.json',contrasts)
 # Direct final-vs-matched-seed Baseline tests, same held-out decks.
 for job in cfg['jobs']:
  if job['architecture']=='baseline':continue
  dest=c/'head-to-head'/job['id'];dest.parent.mkdir(exist_ok=True)
  if dest.exists():continue
  subprocess.run([sys.executable,'-m','scripts.ai7.evaluate','--checkpoints',str(c/'runs'/job['id']/'final.pt'),
    '--historical',str(c/'runs'/f"baseline-seed-{job['seed']}"/'final.pt'),'--output',str(dest),
    '--pairs','64','--seed-start','18000000','--archive-count','0'],check=True,timeout=90)

if __name__=='__main__':main()
