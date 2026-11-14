import copy,json,os,subprocess,sys,time,unittest
from pathlib import Path
import numpy as np
import torch
from scripts.ai7.runtime import ROOT,seed_all,load_checkpoint
from scripts.ai7.tests import test_resume
from scripts.ai7.instrumentation import distribution_stats,cosine

class InstrumentationTests(unittest.TestCase):
 def test_empty_zero_and_cosine(self):
  self.assertIsNone(distribution_stats([])['mean']);self.assertEqual(distribution_stats([0,0])['std'],0)
  self.assertIsNone(cosine(torch.zeros(2),torch.ones(2)))
  self.assertAlmostEqual(cosine(torch.ones(2),-torch.ones(2)),-1)
 def test_cli_equivalence_components_and_resume(self):
  seed_all(19,2)
  root=ROOT/f'benchmark-results/ai7-selfplay/instrumentation-gates/{time.time_ns()}';root.mkdir(parents=True)
  env={**os.environ,'AI7_ARTIFACT_ROOT':str(root),'PYTHONPYCACHEPREFIX':'/tmp/ai7-phase1-cache'}
  common=['--seed','1011','--max-env-steps','20000','--checkpoint-every-steps','5000','--validation-pairs','0','--max-replays','0','--threads','2']
  def run(name,extra):
   out=root/name
   with (root/f'{name}-{time.time_ns()}.log').open('w') as log:
    result=subprocess.run([sys.executable,'-m','scripts.ai7.train','--output',str(out),*common,*extra],env=env,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=120)
   self.assertEqual(result.returncode,0,f'Inspect {root}');return out
  off=run('off',['--instrumentation','off']);on=run('on',['--instrumentation','detailed'])
  split=run('split',['--instrumentation','detailed','--stop-after-updates','2'])
  run('split',['--instrumentation','detailed','--resume',str(split/'latest.pt')])
  checkpoints=[load_checkpoint(p/'final.pt')[1] for p in [off,on,split]]
  comparer=test_resume.ResumeTests()
  for key in ['model','optimizer','torch_rng','numpy_rng','python_rng','sampling_rng','opponent_models','opponent_pool','update','env_steps']:
   comparer.assert_nested_equal(checkpoints[0][key],checkpoints[1][key]);comparer.assert_nested_equal(checkpoints[1][key],checkpoints[2][key])
  self.assertEqual((off/'training-games.jsonl').read_bytes(),(on/'training-games.jsonl').read_bytes())
  self.assertEqual((on/'training-games.jsonl').read_bytes(),(split/'training-games.jsonl').read_bytes())
  metrics=[json.loads(line) for line in (on/'metrics.jsonl').read_text().splitlines()]
  self.assertTrue(all('diagnostics' in m for m in metrics if m['learner_samples']))
  for m in metrics:
   d=m.get('diagnostics');
   if not d:continue
   self.assertAlmostEqual(sum(x['decision_fraction'] for x in d['advantages']['by_outcome'].values()),1)
   for g in d['gradients']:
    self.assertLess(g['component_sum_max_abs_error'],1e-5);self.assertLess(g['outcome_sum_max_abs_error'],1e-5)
    self.assertLessEqual(g['actual_post_clip_norm'],.50001)
   for p in d['probes']:self.assertTrue(np.isfinite(p['kl_before_after']));self.assertGreaterEqual(p['kl_before_after'],0)
  # A split continuation emits the exact diagnostic content, apart from clocks.
  resumed=[json.loads(line) for line in (split/'metrics.jsonl').read_text().splitlines()]
  self.assertEqual([m.get('diagnostics') for m in metrics],[m.get('diagnostics') for m in resumed])
  report={'passed':True,'root':str(root),'off_seconds':json.loads((off/'summary.json').read_text())['training_wall_seconds'],'on_seconds':json.loads((on/'summary.json').read_text())['training_wall_seconds'],'updates':checkpoints[1]['update'],'exact_model_optimizer_rng_pool_games':True,'exact_resume_diagnostics':True}
  (root/'gate-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)

if __name__=='__main__':unittest.main()
