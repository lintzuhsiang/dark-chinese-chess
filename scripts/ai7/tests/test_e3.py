import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch
from torch.distributions import Categorical, kl_divergence

from scripts.ai7.runtime import ROOT, encode, make_policy, mask_array, seed_all, restore_training_checkpoint
from scripts.ai7.train import main
from scripts.ai7.tests.test_relational_head import public_fixtures


class SpatialGatherTests(unittest.TestCase):
    def test_factorization_and_spatial_oracle(self):
        obs,rot=public_fixtures()
        self.assertEqual(obs[0],obs[1])
        self.assertNotIn(33,obs[2]['legal'])
        self.assertEqual([44 in o['legal'] for o in obs[3:]],[False,True,False])
        x=torch.from_numpy(np.stack([encode(o) for o in obs+rot]))
        mask=torch.from_numpy(mask_array(obs+rot))
        mask[0]=False; mask[0,2]=True
        mask[1]=False; mask[1,:32]=True
        seed_all(98000,2);b=make_policy({'architecture':'e3_joint'})
        seed_all(98000,2);c=make_policy({'architecture':'e3_gate'})
        for k,v in b.state_dict().items(): self.assertTrue(torch.equal(v,c.state_dict()[k]))
        bd,bv=b(x,mask);cd,cv=c(x,mask)
        self.assertTrue(torch.equal(bd.probs,cd.probs));self.assertTrue(torch.equal(bv,cv))
        with torch.no_grad(): c.gate.weight.normal_(std=.3)
        cd,cv=c(x,mask);cells,h=c.encode_state(x)
        # Independently compute both softmax factors by group, gather target/source
        # by decoded 8x4 coordinates, compare the full normalized distribution.
        from scripts.ai7.cnn import split_public_features
        board,_=split_public_features(x);maps=c.board(board)
        for r in range(len(x)):
            ids=mask[r].nonzero().flatten().tolist()
            raw=[];groups=[]
            for a in ids:
                t=a%32; f=maps[r,:,t//4,t%4]; parts=[h[r]]
                if a>=32:
                    source=(a-32)//32;parts.append(maps[r,:,source//4,source%4])
                parts.extend([f,c.geometry[a]])
                raw.append((c.move if a>=32 else c.flip)(torch.cat(parts)).flatten()[0])
                groups.append(int(a>=32))
            raw=torch.stack(raw);g=torch.tensor(groups);present=g.unique()
            z=torch.stack([raw[g==i].logsumexp(0)+c.gate(h[r])[i] for i in present]).softmax(0)
            expected=torch.zeros_like(raw)
            for n,i in enumerate(present):expected[g==i]=raw[g==i].softmax(0)*z[n]
            torch.testing.assert_close(cd.probs[r,ids],expected,atol=1e-6,rtol=0)
            self.assertTrue((cd.probs[r,~mask[r]]==0).all())
            torch.testing.assert_close(cd.entropy()[r],-(expected*expected.log()).sum(),atol=1e-6,rtol=1e-6)
            old=bd.probs[r,ids]
            torch.testing.assert_close(kl_divergence(bd,cd)[r],(old*(old.log()-expected.log())).sum(),atol=1e-6,rtol=0)
        a=cd.sample();lp=cd.log_prob(a)
        torch.testing.assert_close((c(x,mask)[0].log_prob(a)-lp.detach()).exp(),torch.ones_like(lp))
        (-lp.mean()).backward()
        for module in (c.board,c.move,c.flip,c.gate):self.assertGreater(sum(p.grad.abs().sum() for p in module.parameters()),0)
        self.assertIsNone(c.critic.weight.grad)
        with self.assertRaises(ValueError):c(x,torch.zeros_like(mask))

    def test_real_training_resume(self):
        target=ROOT/'benchmark-results/ai7-selfplay';target.mkdir(parents=True,exist_ok=True)
        for arm in ('e2b_l','e3_joint','e3_gate'):
            with tempfile.TemporaryDirectory(dir=target) as temp, patch.dict('os.environ',{'AI7_ARTIFACT_ROOT':temp}):
                flags=['--architecture',arm,'--e3-study','--seed','98000','--learning-method','gae_lambda_095','--batch-games','4','--until-step-target','--max-env-steps','1800','--checkpoint-every-steps','900','--validation-pairs','0','--max-replays','0','--threads','2']
                p,q=Path(temp)/'straight',Path(temp)/'resume'
                main(['--output',str(p),*flags])
                main(['--output',str(q),*flags,'--stop-after-updates','1'])
                main(['--output',str(q),*flags,'--resume',str(q/'latest.pt')])
                left=restore_training_checkpoint(p/'final.pt');right=restore_training_checkpoint(q/'final.pt')
                for x,y in zip(left[0].parameters(),right[0].parameters()):self.assertTrue(torch.equal(x,y))
                self.assertEqual(left[3],right[3])
                for k,v in left[1].state_dict()['state'].items():
                    for field,tensor in v.items():self.assertTrue(torch.equal(tensor,right[1].state_dict()['state'][k][field]))
                self.assertEqual((p/'training-games.jsonl').read_bytes(),(q/'training-games.jsonl').read_bytes())
                self.assertTrue(torch.equal(left[-1]['torch_rng'],right[-1]['torch_rng']))
                self.assertGreater(left[-1]['update'],0)
