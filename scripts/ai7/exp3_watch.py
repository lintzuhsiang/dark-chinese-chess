"""Independent watchdog for the detached Experiment 3 supervisor and child group."""
import argparse,os,signal,time,shutil,json
from .exp3 import ROOT_OUT
from .campaign import atomic_json,read_json
from .runtime import ROOT

def main():
 p=argparse.ArgumentParser();p.add_argument('--pid',type=int,required=True);a=p.parse_args()
 deadline=time.time()+7*3600
 reason=None
 while True:
  try:os.kill(a.pid,0)
  except ProcessLookupError:break
  if time.time()>deadline-10:reason='watchdog_deadline'
  elif shutil.disk_usage(ROOT).free<30*1024**3:reason='watchdog_disk_headroom'
  if reason:
   active=read_json(ROOT_OUT/'active-job.json',{})
   if active.get('state')=='running' and active.get('pid'):
    try:os.killpg(active['pid'],signal.SIGTERM)
    except ProcessLookupError:pass
   try:os.kill(a.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   time.sleep(10)
   if active.get('state')=='running' and active.get('pid'):
    try:os.killpg(active['pid'],signal.SIGKILL)
    except ProcessLookupError:pass
   break
  time.sleep(5)
 atomic_json(ROOT_OUT/'watchdog-status.json',{'finished_epoch':time.time(),'reason':reason})

if __name__=='__main__':main()
