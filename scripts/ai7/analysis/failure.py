"""Evaluation only: no optimizer, parameter changes, training or reward changes."""
import json, copy, time, os
from pathlib import Path
import numpy as np
import torch
from scripts.ai7.runtime import ROOT, Bridge, seed_all, load_checkpoint, collect, encode, mask_array, write_json
from scripts.ai7.research import probe_policy

C=ROOT/'benchmark-results/ai7-selfplay/overnight-comparison/20261114-v1'
O=ROOT/'benchmark-results/ai7-selfplay/learning-failure-analysis/20261114-v1'

def value_stats(rows):
    v=np.array([x[0] for x in rows]); y=np.array([x[1] for x in rows]); g=np.array([x[2] for x in rows])
    var=float(np.var(y)); residual=y-v
    return {'decisions':len(y),'games':len(set(g)), 'target_variance':var,'zero_fraction':float(np.mean(y==0)),
      'prediction_mean':float(v.mean()),'prediction_std':float(v.std()),'target_mean':float(y.mean()),
      'explained_variance':float(1-np.var(residual)/var) if var else None,
      'mse':float(np.mean(residual**2)),'zero_predictor_mse':float(np.mean(y*y)),
      'oracle_constant_mse':var,'correlation':float(np.corrcoef(v,y)[0,1]) if v.std() and y.std() else None,
      'crossfit_constant_mse':float(np.mean([(yy-np.mean(y[(g%2)!=(gg%2)]))**2 for yy,gg in zip(y,g)])),
      'class_mse':{str(k):float(np.mean(residual[y==k]**2)) if np.any(y==k) else None for k in [-1,0,1]},
      'game_balanced_mse':float(np.mean([np.mean(residual[g==i]**2) for i in set(g)])),
      'bins':[{'predicted_mean':float(v[ix].mean()),'observed_return':float(y[ix].mean()),'n':len(ix)} for ix in np.array_split(np.argsort(v),5) if len(ix)]}

def key(obs): return json.dumps([obs['board'],obs['player'],obs['color']])

def bank(bridge,runid):
    files=list((C/'evaluations'/runid/'replays').glob('final-*.json'))
    result=[]
    for f in files:
      a=json.loads(f.read_text()); seed=a['metadata']['deckSeed']; seat=int(f.stem.rsplit('-',1)[1])
      obs=bridge.request(command='reset',games=[{'id':0,'seed':seed}])[0]['observation']; seen={key(obs)}; own={}
      for entry in a['actions']:
        action=entry['action']; actor=obs['player']; rev=[]; rep=[]
        for aid in obs['legal']:
          if aid<32: continue
          fr=(aid-32)//32; to=(aid-32)%32
          if own.get(actor)==(to,fr):rev.append(aid)
          nxt=copy.deepcopy(obs); nxt['board'][to]=nxt['board'][fr];nxt['board'][fr]=0;nxt['player']=1-actor;nxt['color']=3-obs['color']
          if key(nxt) in seen:rep.append(aid)
        if actor==seat and obs['ply']>=80 and (rev or rep):
          result.append({'observation':obs,'reversal':rev,'repeated':rep,'seed':seed,'ply':obs['ply']})
        if action['type']=='MOVE':
          aid=32+action['from']*32+action['to'];own[actor]=(action['from'],action['to'])
        else:aid=action['position'];own.pop(actor,None)
        step=bridge.request(command='step',actions=[{'id':0,'action':aid}])[0]
        if step['terminated']:break
        obs=step['observation'];seen.add(key(obs))
    return result

def main():
    O.mkdir(parents=True,exist_ok=False);os.environ['AI7_ARTIFACT_ROOT']=str(O);seed_all(19,2)
    bridge=Bridge(O/'bridge');suite=bridge.request(command='probes'); results=[]
    try:
      for arch in ['baseline','critic','cnn']:
       for seed in [11,23,37]:
        rid=f'{arch}-seed-{seed}';run=C/'runs'/rid
        ev=json.loads((C/'evaluations'/rid/'summary.json').read_text()); wdl=[{k:x[k] for k in ['checkpoint','wins','draws','losses','completed']} for x in ev['matchups']]
        paths=[run/'initial.pt',*sorted(run.glob('step-*.pt')),run/'final.pt'];probes=[];vals={};pref=[]
        states=bank(bridge,rid) if arch=='baseline' else []
        if states:write_json(O/f'{rid}-fixed-states.json',states)
        for path in paths:
         model,meta=load_checkpoint(path); p=probe_policy(model,suite);probes.append({'steps':meta['env_steps'],'checkpoint':path.name,**p})
         if states:
          measurements=[]
          for start in range(0,len(states),64):
           block=states[start:start+64]; obs=[x['observation'] for x in block]
           with torch.no_grad():d,_=model(torch.from_numpy(np.stack([encode(x) for x in obs])),torch.from_numpy(mask_array(obs))); probs=d.probs.numpy()
           for st,pr in zip(block,probs):measurements.append({k:st[k] for k in ['seed','ply']}|{'reversal_mass':float(pr[st['reversal']].sum()),'repeat_mass':float(pr[st['repeated']].sum()),'has_repeat':bool(st['repeated']),'top_probability':float(pr.max()),'top_is_repeat':int(pr.argmax()) in st['repeated'],'uniform_repeat_mass':len(st['repeated'])/len(st['observation']['legal'])})
          pref.append({'steps':meta['env_steps'],'states':measurements})
         if path.name not in ['initial.pt','final.pt']:continue
         for opponent in ['random','current']:
          if path.name=='initial.pt' and opponent=='current':continue
          rows=[];games=[]
          specs=[{'seed':4_000_000+i,'seat':seat,'action_seed':(4_000_000+i)^0x13579,'opponent':opponent} for i in range(32) for seat in [0,1]]
          for start in range(0,len(specs),16):
           batch=collect(bridge,model,specs[start:start+16],{},training=True)
           assert batch['incomplete']==0
           for j,(trajectory,game) in enumerate(zip(batch['trajectories'],batch['games'])):
            rows.extend((x['value'],game['return'],start+j) for x in trajectory)
           games.extend(batch['games'])
          label=path.stem+'-'+opponent;vals[label]={'stats':value_stats(rows),'games':games}
          write_json(O/f'{rid}-{label}-value-samples.json',rows)
        result={'run_id':rid,'wdl':wdl,'probes':probes,'value':vals,'fixed_state_preferences':pref}
        write_json(O/f'{rid}.json',result);results.append(result);print(rid,'done',flush=True)
      write_json(O/'results.json',results)
    finally:bridge.close()
if __name__=='__main__':main()
