import copy,types,unittest
from pathlib import Path
import numpy as np
from scripts.ai7.runtime import ROOT,advantages
from scripts.ai7.restart_sampling import RestartSampler
from scripts.ai7.train import configuration,parse_args

class Campaign5Tests(unittest.TestCase):
 def test_exact_lambda_and_resume(self):
  for lam in [.85,.9,.95]:
   args=['--output','/tmp/unused','--learning-method','gae_lambda_095','--gae-lambda',str(lam)]
   c=configuration(parse_args(args));self.assertEqual(c['gamma'],1.);self.assertEqual(c['gae_lambda'],lam)
   np.testing.assert_allclose(advantages([{'reward':0,'value':.2},{'reward':1,'value':.4}],1,lam)[0],[.2+lam*.6,.6],atol=1e-6)
   self.assertEqual(configuration(parse_args(['--output','/tmp/unused']),c)['gae_lambda'],lam)
   with self.assertRaises(ValueError):configuration(parse_args(args[:-1]+[str(.85 if lam!=.85 else .9)]),c)
 def test_original_sampling_unchanged(self):
  path=ROOT/'benchmark-results/ai7-selfplay/gae-restart-strategies-20261115/verified-training-v1/source-snapshot/scripts/ai7/restart_sampling.py'
  if not path.exists():self.skipTest('Historical source snapshot unavailable')
  m=types.ModuleType('original');exec(path.read_text(),m.__dict__)
  catalog=[{'id':'x','stage':'endgame','endgameEligible':True}]
  for treatment in ['B0','B2']:
   a=m.RestartSampler(catalog,'archive',treatment,77);b=RestartSampler(catalog,'archive',treatment,77)
   self.assertEqual(a.identity,b.identity)
   self.assertEqual([a.sample() for _ in range(5000)],[b.sample() for _ in range(5000)])
  for probability in [.5,.7]:
   s=RestartSampler(catalog,'archive','B2',77,restart_probability=probability)
   for _ in range(10000):s.sample()
   self.assertAlmostEqual(s.restart_starts/10000,probability,delta=.02)
   saved=s.state_dict();other=RestartSampler(catalog,'archive','B2',77,restart_probability=probability);other.load_state_dict(saved)
   self.assertEqual([s.sample() for _ in range(100)],[other.sample() for _ in range(100)])

 def test_evaluation_summary_counts_and_rates(self):
  from scripts.ai7.campaign5 import metrics
  games=[{'seat':0,'plies':10,'result':{'type':'WIN','winner':'P1','reason':'NO_PIECES'}},{'seat':0,'plies':20,'result':{'type':'WIN','winner':'P2','reason':'NO_LEGAL_ACTION'}},{'seat':1,'plies':30,'result':{'type':'DRAW','reason':'NO_PROGRESS'}}]
  m=metrics(games)
  self.assertEqual((m['wins'],m['draws'],m['losses']),(1,1,1));self.assertEqual(m['score'],.5)
  self.assertEqual(m['loss_rate'],1/3);self.assertEqual(m['win_rate'],1/3);self.assertEqual(m['draw_rate'],1/3)
  self.assertEqual(m['mean_plies'],20);self.assertEqual(m['median_plies'],20)
