"""Synthetic invariants and bounded real-Core Campaign4A correctness pilots."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

import numpy as np
import torch

from scripts.ai7.runtime import ROOT, Policy, advantages, collect, load_checkpoint, seed_all
from scripts.ai7.tests.test_resume import ResumeTests
from scripts.ai7_4a.train import extra_passes


class CorrectnessTests(unittest.TestCase):
    def test_reward_perspective_and_truncation_exclusion(self):
        path=ROOT/'benchmark-results/ai7-selfplay/intel-p0/20261115-v1/imports/intel-evaluation-bundle/tactical-bank/stage2.json'
        observation=json.loads(path.read_text())['bank'][0]['observation']
        seed_all(7091,1); model=Policy()
        class Transport:
            def __init__(self,seat,terminal): self.seat,self.terminal=seat,terminal
            def request(self,command,**kwargs):
                if command=='reset': return [{'id':0,'observation':{**observation,'player':self.seat}}]
                if self.terminal:
                    return [{'id':0,'terminated':True,'rewards':{'P1':1,'P2':-1},
                             'summary':{'result':{'type':'WIN','winner':'P1','reason':'NO_PIECES'}}}]
                return [{'id':0,'terminated':False,'observation':{**observation,'player':self.seat}}]
        for seat,expected in [(0,1),(1,-1)]:
            specs=[{'seed':1,'seat':seat,'action_seed':99,'opponent':'random'}]
            report=collect(Transport(seat,True),model,specs,{},training=True)
            self.assertEqual(report['trajectories'][0][-1]['reward'],expected)
            report=collect(Transport(seat,False),model,specs,{},training=True,max_env_steps=1)
            self.assertEqual(report['env_steps'],1)
            self.assertEqual(report['incomplete'],1)
            self.assertEqual(report['trajectories'],[])
            self.assertEqual(report['games'],[])

    def test_gae_terminal_recurrence_both_lambdas(self):
        rows=[{'reward':0.,'value':.25},{'reward':0.,'value':-.4},{'reward':1.,'value':.7}]
        for lam in [.95,.8]:
            expected=[]; carry=0.; next_value=0.
            for row in reversed(rows):
                carry=row['reward']+next_value-row['value']+lam*carry
                expected.insert(0,carry); next_value=row['value']
            a,t=advantages(rows,1.,lam)
            np.testing.assert_allclose(a,expected,atol=1e-6)
            np.testing.assert_allclose(t,a+np.array([r['value'] for r in rows]),atol=1e-6)
            self.assertAlmostEqual(t[-1],1.)

    def test_extra_phase_parameters_logits_PPO_state_and_rng(self):
        seed_all(7101,1); model=Policy()
        ppo=torch.optim.Adam(model.parameters(),lr=.0003,eps=1e-5)
        x=torch.randn(520,2163); masks=torch.zeros(520,1056,dtype=torch.bool); masks[:,[1,4,73]]=True
        policy,values=model(x,masks); (values.square().mean()+policy.entropy().mean()).backward(); ppo.step()
        with torch.no_grad(): before_logits=model(x,masks)[0].logits.clone()
        weights={k:v.clone() for k,v in model.state_dict().items()}; state=copy.deepcopy(ppo.state_dict())
        rng=torch.get_rng_state().clone(); target=torch.ones(520)
        extra=torch.optim.Adam(model.critic.parameters(),lr=.0003,eps=1e-5)
        result=extra_passes(model,extra,x,target)
        self.assertEqual(result['extra_critic_steps'],6)
        self.assertTrue(torch.equal(rng,torch.get_rng_state()))
        with torch.no_grad(): self.assertTrue(torch.equal(before_logits,model(x,masks)[0].logits))
        for name,value in model.state_dict().items():
            if not name.startswith('critic.'): self.assertTrue(torch.equal(value,weights[name]),name)
        self.assertTrue(any(not torch.equal(v,weights[k]) for k,v in model.state_dict().items() if k.startswith('critic.')))
        ResumeTests().assert_nested_equal(state,ppo.state_dict())
        self.assertTrue(all(p.requires_grad for p in model.parameters()))

    def test_real_core_A0_equivalence_and_extra_resume(self):
        root=ROOT/f'benchmark-results/ai7-selfplay/gae-critic-factorial-20261115/pilots/correctness-{time.time_ns()}'
        root.mkdir(parents=True)
        env={**os.environ,'AI7_ARTIFACT_ROOT':str(root),'PYTHONDONTWRITEBYTECODE':'1'}
        common=['--learning-method','gae_lambda_095','--seed','7091','--max-env-steps','6000',
                '--checkpoint-every-steps','2000','--batch-games','4','--threads','1','--validation-pairs','0',
                '--max-replays','0','--until-step-target']
        def run(name,treatment=None,extra=()):
            out=root/name; module='scripts.ai7_4a.train' if treatment else 'scripts.ai7.train'
            cmd=[sys.executable,'-B','-m',module,*(['--treatment',treatment] if treatment else []),
                 '--output',str(out),*common,*extra]
            with (root/f'{name}-{time.time_ns()}.log').open('w') as stream:
                result=subprocess.run(cmd,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=240)
            self.assertEqual(result.returncode,0,f'Inspect {root}')
            return out
        original=run('existing-gae095'); control=run('A0','A0')
        a=load_checkpoint(original/'final.pt')[1]; b=load_checkpoint(control/'final.pt')[1]
        keys=['model','optimizer','torch_rng','numpy_rng','python_rng','sampling_rng','opponent_pool','opponent_models','update','env_steps']
        for key in keys: ResumeTests().assert_nested_equal(a[key],b[key])
        self.assertEqual((original/'training-games.jsonl').read_bytes(),(control/'training-games.jsonl').read_bytes())
        for treatment in ['A1','A2','A3']:
            full=run(treatment+'-full',treatment)
            partial=run(treatment+'-resume',treatment,['--stop-after-updates','2'])
            self.assertLess(load_checkpoint(partial/'latest.pt')[1]['env_steps'],6000)
            run(treatment+'-resume',treatment,['--resume',str(partial/'latest.pt')])
            a=load_checkpoint(full/'final.pt')[1]; b=load_checkpoint(partial/'final.pt')[1]
            for key in keys: ResumeTests().assert_nested_equal(a[key],b[key])
            self.assertEqual(a['env_steps'],6000)
            self.assertEqual((full/'training-games.jsonl').read_bytes(),(partial/'training-games.jsonl').read_bytes())
            if treatment in ['A1','A3']:
                self.assertIn('extra_value_optimizer',a['optimizer'])
                self.assertTrue(a['optimizer']['extra_value_optimizer']['state'])
        (root/'verification.json').write_text(json.dumps({'passed':True,'A0_exact_model_PPO_pool_RNG_games':True,
            'resume_exact':['A1','A2','A3'],'target':6000,'test_only_not_model_selection':True},indent=2)+'\n')
        print('Bounded pilot evidence:',root,flush=True)


if __name__=='__main__':
    unittest.main()
