"""Bounded audit must be passive and exact on resume, with decision/minibatch links."""
import json, os, subprocess, sys, time, unittest
import numpy as np
from scripts.ai7.runtime import ROOT, load_checkpoint
from scripts.ai7.tests import test_resume

class AuditTests(unittest.TestCase):
 def test_passive_links_full_replays_and_resume(self):
  root=ROOT/f'benchmark-results/ai7-selfplay/audit-gates/{time.time_ns()}'
  root.mkdir(parents=True)
  env=dict(os.environ, AI7_ARTIFACT_ROOT=str(root), PYTHONPYCACHEPREFIX='/tmp/ai7-audit-cache')
  common=['--seed','1011','--max-env-steps','12000','--checkpoint-every-steps','6000','--validation-pairs','0','--threads','2','--max-replays','32']
  def run(name, flags):
   out=root/name
   with (root/f'{name}-{time.time_ns()}.log').open('w') as log:
    result=subprocess.run([sys.executable,'-m','scripts.ai7.train','--output',str(out),*common,*flags],env=env,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=120)
   self.assertEqual(result.returncode,0,str(root));return out
  off=run('off',[])
  flags=['--audit-records','full','--instrumentation','detailed','--replay-sample-denominator','1']
  on=run('on',flags)
  split=run('split',flags+['--stop-after-updates','1'])
  run('split',flags+['--resume',str(split/'latest.pt')])
  checkpoints=[load_checkpoint(p/'final.pt')[1] for p in [off,on,split]]
  compare=test_resume.ResumeTests()
  for key in ['model','optimizer','torch_rng','numpy_rng','python_rng','sampling_rng','opponent_pool','opponent_models','update','env_steps']:
   compare.assert_nested_equal(checkpoints[0][key],checkpoints[1][key]);compare.assert_nested_equal(checkpoints[1][key],checkpoints[2][key])
  records=[json.loads(x) for x in (on/'metrics.jsonl').read_text().splitlines()]
  resumed=[json.loads(x) for x in (split/'metrics.jsonl').read_text().splitlines()]
  self.assertEqual([x.get('diagnostics') for x in records],[x.get('diagnostics') for x in resumed])
  for row in records:
   if not row['learner_samples']:continue
   d=row['diagnostics'];self.assertEqual(len(d['gradients']),row['optimizer_steps'])
   self.assertEqual(len(d['decisions']),row['learner_samples'])
   for decision in d['decisions']:
    self.assertIsNotNone(decision['ply'])
    self.assertAlmostEqual(sum(decision['old_legal_probabilities']),1.,places=5)
    self.assertAlmostEqual(float(np.log(decision['old_legal_probabilities'][decision['legal'].index(decision['action'])])),decision['old_log_probability'],places=5)
    self.assertAlmostEqual(decision['raw_advantage'],decision['outcome']-decision['old_value'],places=5)
    self.assertAlmostEqual(decision['return_target'],decision['outcome'],places=5)
   for g in d['gradients']:
    self.assertEqual(len(g['row_indices']),len(g['importance_ratios']))
    self.assertEqual(len(g['probes']),8)
    self.assertGreaterEqual(g['adam_parameter_delta_l2'],0)
    self.assertTrue(all(0<=i<len(d['decisions']) for i in g['row_indices']))
   for game in d['games']:self.assertTrue((on/'training-replays'/game['archive']).exists())
  self.assertGreater(checkpoints[1]['training_state']['replay_count'],4)
  cap=run('cap',flags+['--audit-max-bytes','1'])
  self.assertEqual(json.loads((cap/'summary.json').read_text())['stop_reason'],'audit_budget')
  self.assertEqual(load_checkpoint(cap/'final.pt')[1]['update'],0)
  print(json.dumps({'root':str(root),'updates':len(records),'audit_bytes':checkpoints[1]['training_state']['audit_bytes'],
    'off_seconds':json.loads((off/'summary.json').read_text())['training_wall_seconds'],
    'on_seconds':json.loads((on/'summary.json').read_text())['training_wall_seconds']}),flush=True)

if __name__=='__main__':unittest.main()
