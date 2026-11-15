"""Public coordinate transforms and passive experiment-3 reward adapters."""
import copy

def rotate_id(a):
    return 31-a if a<32 else 32+(31-(a-32)//32)*32+31-(a-32)%32

def rotate_observation(o):
    ref=lambda v:33-v if v else 0
    return {**o,'board':o['board'][::-1],'references':[ref(v) for v in o['references'][::-1]],
            'history':[[ref(v) if i in [2,3,4,5] else v for i,v in enumerate(e)] for e in o['history']],
            'legal':[rotate_id(a) for a in o['legal']]}

def reward_for(result, original, penalty):
    return penalty if result['type']=='DRAW' and result['reason']=='NO_PROGRESS' else original

def audit_window(steps,target):
    f=steps/max(1,target)
    return any(lo<=f<hi for lo,hi in [(0,.01),(.245,.255),(.495,.505),(.745,.755),(.99,1.01)])
