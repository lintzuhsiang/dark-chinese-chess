"""Passive PPO diagnostics. No optimizer calls, RNG draws, rewards, or selection."""
from __future__ import annotations
import hashlib
import json
import numpy as np
import torch
from .runtime import encode, mask_array


def distribution_stats(values):
    a=np.asarray(values,dtype=np.float64)
    if not len(a): return {'n':0,'mean':None,'std':None,'quantiles':None,'positive_fraction':None,'negative_fraction':None}
    return {'n':len(a),'mean':float(a.mean()),'std':float(a.std()),'quantiles':np.quantile(a,[0,.05,.25,.5,.75,.95,1]).tolist(),'positive_fraction':float(np.mean(a>0)),'negative_fraction':float(np.mean(a<0))}


def advantage_diagnostics(trajectories, raw):
    outcomes=np.concatenate([np.full(len(t),t[-1]['reward']) for t in trajectories])
    norm=(raw-raw.mean())/(raw.std()+1e-8)
    return {'raw':distribution_stats(raw),'normalized':distribution_stats(norm), 'by_outcome':{
        str(reward):{'games':sum(t[-1]['reward']==reward for t in trajectories),'game_fraction':sum(t[-1]['reward']==reward for t in trajectories)/len(trajectories),
                     'decisions':int((outcomes==reward).sum()),'decision_fraction':float(np.mean(outcomes==reward)),
                     'raw':distribution_stats(raw[outcomes==reward]),'normalized':distribution_stats(norm[outcomes==reward])} for reward in [-1,0,1]}}


def flat_gradient(loss, parameters):
    grads=torch.autograd.grad(loss,parameters,retain_graph=True,allow_unused=True)
    return torch.cat([(torch.zeros_like(p) if g is None else g).detach().flatten().cpu() for p,g in zip(parameters,grads)])


def cosine(a,b):
    denominator=torch.linalg.vector_norm(a.double())*torch.linalg.vector_norm(b.double())
    return float(torch.dot(a.double(),b.double())/denominator) if denominator>0 else None


class UpdateDiagnostics:
    def __init__(self, model, suite, initial_probabilities, update, interval=10):
        self.model=model;self.suite=suite;self.initial=initial_probabilities;self.update=update
        self.detailed=update<=10 or update%interval==0
        self.record={'update':update,'gradient_sampling':'first minibatch of each PPO epoch' if self.detailed else 'none','gradients':[]}
        self.before=self.probe_snapshot()
        self.sampled_epochs=set()

    def probe_snapshot(self):
        obs=[p['observation'] for p in self.suite['probes']]
        device=next(self.model.parameters()).device
        with torch.no_grad():
            d,_=self.model(torch.from_numpy(np.stack([encode(o) for o in obs])).to(device),torch.from_numpy(mask_array(obs)).to(device))
            return d.probs.detach().cpu().numpy().copy()

    def gradients(self,epoch,minibatch,policy_loss,value_loss,entropy,loss,per_row_policy,outcomes,config):
        if not self.detailed or epoch in self.sampled_epochs:return
        self.sampled_epochs.add(epoch)
        params=tuple(self.model.parameters())
        actor=flat_gradient(policy_loss,params)
        critic=flat_gradient(config['value_coefficient']*value_loss,params)
        exploration=flat_gradient(-config['entropy_coefficient']*entropy,params)
        total=flat_gradient(loss,params)
        indices=[];offset=0
        for name,p in self.model.named_parameters():
            if name.startswith('body.') and self.model.config.get('architecture','baseline')=='baseline': indices.extend(range(offset,offset+p.numel()))
            offset+=p.numel()
        shared=torch.tensor(indices,dtype=torch.long)
        norms={k:float(torch.linalg.vector_norm(g.double())) for k,g in [('actor',actor),('critic_weighted',critic),('entropy_weighted',exploration),('combined',total)]}
        classes={}; vectors=[]
        for reward in [-1,0,1]:
            selected=outcomes==reward
            if selected.any():
                # Same full-batch denominator and already globally normalized advantages.
                v=flat_gradient(per_row_policy[selected].sum()/len(outcomes),params);vectors.append(v)
                classes[str(reward)]={'samples':int(selected.sum()),'norm':float(torch.linalg.vector_norm(v.double())), 'cosine_to_total_actor':cosine(v,actor)}
            else:classes[str(reward)]={'samples':0,'norm':None,'cosine_to_total_actor':None}
        self.record['gradients'].append({'epoch':epoch,'minibatch':minibatch,'norms':norms,
            'shared_actor_critic_cosine':cosine(actor[shared],critic[shared]) if len(shared) else None,
            'shared_critic_actor_norm_ratio':float(torch.linalg.vector_norm(critic[shared].double())/torch.linalg.vector_norm(actor[shared].double())) if len(shared) and torch.linalg.vector_norm(actor[shared])>0 else None,
            'component_sum_max_abs_error':float((actor+critic+exploration-total).abs().max()),
            'outcome_sum_max_abs_error':float((sum(vectors)-actor).abs().max()),'actor_by_outcome':classes})

    def clipping(self,before,after):
        if self.record['gradients'] and 'actual_pre_clip_norm' not in self.record['gradients'][-1]:
            self.record['gradients'][-1].update(actual_pre_clip_norm=before,actual_post_clip_norm=after)

    def finish(self):
        after=self.probe_snapshot(); initial=np.asarray(self.initial,dtype=np.float64)
        def kl(a,b):
            allowed=a>0
            return float(np.sum(a[allowed]*(np.log(a[allowed])-np.log(np.maximum(b[allowed],np.finfo(np.float64).tiny)))))
        probes=[]
        for i,p in enumerate(self.suite['probes']):
            probes.append({'id':p['id'],'kl_before_after':max(0,kl(self.before[i].astype(float),after[i].astype(float))),
                'kl_initial_after':max(0,kl(initial[i],after[i].astype(float))),
                'groups':{name:{'before':float(self.before[i,ids].sum()),'after':float(after[i,ids].sum())} for name,ids in p['groups'].items() if ids}})
        self.record['probes']=probes
        return self.record


def suite_fingerprint(suite):
    return hashlib.sha256(json.dumps(suite,sort_keys=True,separators=(',',':')).encode()).hexdigest()
