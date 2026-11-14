import json,os,subprocess,sys,time,unittest,copy
from pathlib import Path
import numpy as np
from scripts.ai7.train import configuration,parse_args,sample_opponent
from scripts.ai7.runtime import ROOT,load_checkpoint,seed_all,Bridge
from scripts.ai7.tests import test_resume
from scripts.ai7.campaign import validate_config

class P1P2Tests(unittest.TestCase):
 def test_only_declared_configuration_changes(self):
  base=configuration(parse_args(['--output','/tmp/unused']))
  low=configuration(parse_args(['--output','/tmp/unused','--learning-rate','.0001']))
  rich=configuration(parse_args(['--output','/tmp/unused','--opponent-mixture','random_rich']))
  self.assertEqual({k for k in base if base[k]!=low[k]},{'learning_rate'})
  self.assertEqual({k for k in base if base[k]!=rich[k]},{'opponent_mixture','opponent_sampling'})
  for flags in [['--learning-rate','.0002'],['--opponent-mixture','random_rich']]:
   with self.assertRaises(ValueError):configuration(parse_args(['--output','/tmp/unused',*flags]),base)
 def test_campaign_matrix_rejects_combined_treatment(self):
  from scripts.ai7.tests.test_campaign import config_fixture
  from scripts.ai7.prepare_p1p2 import TREATMENTS,SEEDS
  c=config_fixture();c.update(experiment_type='p1p2',architectures=list(TREATMENTS),seeds=SEEDS,treatments=copy.deepcopy(TREATMENTS),jobs=[{'id':f'{g}-seed-{seed}','architecture':g,'seed':seed} for seed in SEEDS for g in TREATMENTS])
  output=ROOT/'benchmark-results/ai7-selfplay/p1p2-comparison/test'
  validate_config(c,output)
  c['treatments']['low_lr']['opponent_mixture']='random_rich'
  with self.assertRaises(ValueError):validate_config(c,output)
 def test_sampling_and_warmup(self):
  history=['initial','old','r1','r2','r3'];rng=np.random.default_rng(13)
  chosen=[sample_opponent(rng,10,history,'random_rich') for _ in range(20000)]
  self.assertAlmostEqual(chosen.count('current')/len(chosen),.3,delta=.02)
  self.assertAlmostEqual(chosen.count('random')/len(chosen),.4,delta=.02)
  a=np.random.default_rng(12);b=np.random.default_rng(12)
  self.assertEqual([sample_opponent(a,1,history,'standard') for _ in range(100)],[sample_opponent(b,1,history,'random_rich') for _ in range(100)])
 def test_resume_all_treatments_and_confirmation(self):
  seed_all(19,2);root=ROOT/f'benchmark-results/ai7-selfplay/p1p2-gates/{time.time_ns()}';root.mkdir(parents=True)
  env={**os.environ,'AI7_ARTIFACT_ROOT':str(root),'PYTHONPYCACHEPREFIX':'/tmp/ai7-p1p2-cache'}
  bridge=Bridge(root/'bridge')
  try:
   suite=bridge.request(command='confirmation-probes');self.assertEqual(len(suite['probes']),8)
   self.assertTrue(any(p['groups']['immediate_win'] for p in suite['probes']))
   self.assertTrue(any(p['groups']['lowest_flip_risk'] for p in suite['probes']))
   self.assertTrue(any(p['groups']['repetition_winning_break'] for p in suite['probes']))
  finally:bridge.close()
  check=test_resume.ResumeTests()
  for name,extra in [('baseline',[]),('low_lr',['--learning-rate','.0001']),('random_rich',['--opponent-mixture','random_rich'])]:
   def run(kind,more):
    out=root/f'{name}-{kind}'
    cmd=[sys.executable,'-m','scripts.ai7.train','--output',str(out),'--seed','4011','--max-env-steps','6000','--checkpoint-every-steps','2000','--batch-games','4','--threads','1','--validation-pairs','0','--max-replays','0','--instrumentation','detailed',*extra,*more]
    with (root/f'{name}-{kind}-{time.time_ns()}.log').open('w') as log:r=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=90)
    self.assertEqual(r.returncode,0,str(root));return out
   full=run('full',[]);split=run('split',['--stop-after-updates','2']);run('split',['--resume',str(split/'latest.pt')])
   a=load_checkpoint(full/'final.pt')[1];b=load_checkpoint(split/'final.pt')[1]
   for key in ['model','optimizer','torch_rng','numpy_rng','python_rng','sampling_rng','opponent_models','opponent_pool']:check.assert_nested_equal(a[key],b[key])
   self.assertEqual((full/'training-games.jsonl').read_bytes(),(split/'training-games.jsonl').read_bytes())
if __name__=='__main__':unittest.main()
