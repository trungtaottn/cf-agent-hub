"""Pagination transcript models only, not application execution or side-channel proof."""
import json
from pathlib import Path

def candidate(rows,limit):
 out=[]
 for i in range(0,len(rows),limit):
  chunk=rows[i:i+limit];out.append({'data':[x for x in chunk if x is not None],'more':i+limit<len(rows)})
 return out or [{'data':[],'more':False}]

def fixed(rows,limit,budget=4):
 out=[];i=0
 while i<len(rows):
  page=[];used=0
  while i<len(rows) and len(page)<limit and used<budget:
   x=rows[i];i+=1;used+=1
   if x is not None:page.append(x)
  out.append({'data':page,'more':i<len(rows)})
 return out or [{'data':[],'more':False}]

def authorized(rows,limit):
 v=[x for x in rows if x is not None]
 return [{'data':v[i:i+limit],'more':i+limit<len(v)} for i in range(0,len(v),limit)] or [{'data':[],'more':False}]

report=[]
for hidden in [0,1,2,3,4,5,7,8,9,16]:
 rows=[None]*hidden+['a','b']
 report.append({'hidden':hidden,'candidate_limit1':candidate(rows,1),'fixed4_limit1':fixed(rows,1),'authorized_limit1':authorized(rows,1)})
base=authorized(['a','b'],1)
assert all(r['authorized_limit1']==base for r in report)
assert len({json.dumps(r['candidate_limit1']) for r in report})==len(report)
assert len({json.dumps(r['fixed4_limit1']) for r in report})>1
# Authorized lookahead: hidden-only suffix must never advertise a next page.
assert authorized(['a']+[None]*20,1)==[{'data':['a'],'more':False}]
# Fixed frontier still lets an attacker count empty pages (coarse cardinality).
assert len(fixed([None]*16+['a','b'],1))>len(fixed(['a','b'],1))
# Permission change: re-evaluate authorized rows; newly visible earlier rows require fresh traversal.
rows=[(1,None),(2,'a'),(3,'b')];last=2
assert [v for seq,v in rows if seq>last and v is not None]==['b']
new=[(1,'new'),(2,'a'),(3,None)]
assert [v for seq,v in new if seq>last and v is not None]==[]
p=Path(__file__).resolve().parent/'results.json'
p.write_text(json.dumps({'label':'model transcripts, not actual API test','checks':'5 assertions passed','cases':report},indent=2)+'\n')
print('PASS: exact-count leak with candidate limit1, residual fixed-budget leak, authorized projection transcript invariance and hidden-suffix termination, current-visibility continuation')
