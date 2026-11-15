import unittest
from scripts.ai7.exp3_support import rotate_id,rotate_observation,reward_for,audit_window
class Exp3Tests(unittest.TestCase):
 def test_reward_preserves_draw_reason_and_winner(self):
  self.assertEqual(reward_for({'type':'DRAW','reason':'NO_PROGRESS'},0,-.2),-.2)
  self.assertEqual(reward_for({'type':'DRAW','reason':'CHASE_STALEMATE'},0,-.2),0)
  self.assertEqual(reward_for({'type':'WIN','winner':'P1'},1,-.2),1)
 def test_rotation_public_reference_and_history(self):
  o={'board':list(range(32)),'references':list(range(1,33)),'history':[[2,1,1,32,5,0,1,2,0,0]],'legal':list(range(1056))}
  self.assertEqual(rotate_observation(rotate_observation(o)),o)
  self.assertEqual(rotate_observation(o)['history'][0],[2,1,32,1,28,0,1,2,0,0])
  self.assertEqual([rotate_id(rotate_id(i)) for i in range(1056)],list(range(1056)))
 def test_windows_declared_not_result_selected(self):
  self.assertTrue(audit_window(0,1000));self.assertTrue(audit_window(250,1000));self.assertFalse(audit_window(400,1000))
