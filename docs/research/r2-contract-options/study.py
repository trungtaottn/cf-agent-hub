"""Synthetic proposed SQLite query-shape study, NOT application benchmark."""
import sqlite3, random, time, statistics, json, platform, hashlib
from pathlib import Path
r=random.Random(20261026)
c=sqlite3.connect(':memory:')
c.executescript('''CREATE TABLE results(sequence INTEGER PRIMARY KEY,task_id TEXT NOT NULL,submitted_at INTEGER NOT NULL,body TEXT NOT NULL);
CREATE INDEX result_page ON results(task_id,sequence);
CREATE TABLE events(sequence INTEGER PRIMARY KEY,resource_type TEXT NOT NULL,resource_id TEXT NOT NULL,type TEXT NOT NULL,summary TEXT NOT NULL);
CREATE INDEX events_resource ON events(resource_type,resource_id,sequence);
''')
# Deliberate skew/stress: 20k hot task, 80k spread over 10k tasks; not observed production distribution.
rows=[]; events=[]
for i in range(1,100001):
 task='hot' if i<=20000 else 'task_'+str(r.randrange(10000))
 body=json.dumps(dict(summary='x'*r.choice([128,512,2048]),artifact_ids=['a'+str(i)],run_id='run'+str(i),submitted_by={'kind':'agent','agent_id':'a1'},submitted_at=i//10))
 rows.append((i,task,i//10,body))
 for k in range(4):events.append((4*i+k,'task',task,'submitted' if k==0 else 'updated','sanitized summary'))
c.executemany('INSERT INTO results VALUES (?,?,?,?)',rows);c.executemany('INSERT INTO events VALUES (?,?,?,?,?)',events);c.commit()
queries={
 'keyset':('SELECT body FROM results WHERE task_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT 50',('hot',19000,20000)),
 'offset':('SELECT body FROM results WHERE task_id=? AND sequence<=? ORDER BY sequence LIMIT 50 OFFSET 19000',('hot',20000)),
 'all_history':('SELECT body FROM results WHERE task_id=? ORDER BY sequence',('hot',)),
 'indexed_audit_summaries':("SELECT summary FROM events WHERE resource_type='task' AND resource_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT 50",('hot',76000,80000)),
 'small_task_keyset':('SELECT body FROM results WHERE task_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT 50',('task_42',0,100000))}
samples={x:[] for x in queries};counts={};plans={}
for name,(q,p) in queries.items():
 counts[name]=len(c.execute(q,p).fetchall());plans[name]=[list(x) for x in c.execute('EXPLAIN QUERY PLAN '+q,p)]
for repeat in range(75):
 names=list(queries);r.shuffle(names)
 for name in names:
  q,p=queries[name];t=time.perf_counter_ns();c.execute(q,p).fetchall();samples[name].append((time.perf_counter_ns()-t)/1e6)
metrics={n:dict(n=len(v),median_ms=statistics.median(v),p95_ms=sorted(v)[int(.95*(len(v)-1))],min_ms=min(v),max_ms=max(v),rows=counts[n]) for n,v in samples.items()}
# Formal small counterexample: high-water by timestamp+opaque ID admits a later insertion below ceiling.
initial=[(1,100,'b'),(2,100,'z')];later=(3,100,'m');timestamp_page=[x for x in initial+[later] if (100,'b')<(x[1],x[2])<=(100,'z')];seq_page=[x for x in initial+[later] if 1<x[0]<=2]
assert later in timestamp_page and later not in seq_page
# Snapshot at epoch 7 contains active credential, revoked after snapshot. No trustworthy post-backup dynamic ledger.
credential={'epoch':7,'enabled':True};restored_epoch=8
retain={**credential,'epoch':restored_epoch};revoke={**credential,'enabled':False}
assert retain['enabled'] and retain['epoch']==restored_epoch
assert not(revoke['enabled'] and revoke['epoch']==restored_epoch)
# Advancing identity alone neither revives archived agent nor old token; fresh issue works for active only.
checks=[]
for state in ['active','disabled','archived']:
 for fresh in [False,True]:
  agent_epoch=8;cred_epoch=8 if fresh else 7;enabled=fresh
  allowed=state=='active' and enabled and agent_epoch==cred_epoch==8
  assert allowed==(state=='active' and fresh);checks.append(dict(state=state,fresh=fresh,allowed=allowed))
out=dict(label='SYNTHETIC SQL microbenchmark; not production/application acceptance',seed=20261026,python=platform.python_version(),sqlite=sqlite3.sqlite_version,platform=platform.platform(),row_counts={'results':len(rows),'events':len(events)},measurement='in-memory warm SQLite, randomized query order 75 repetitions; query+fetch only; no auth/crypto/network',metrics=metrics,raw_samples_ms=samples,plans=plans,counterexamples={'timestamp_highwater_includes_new_row':True,'sequence_highwater_excludes_new_row':True,'restored_retained_old_credential_reactivated':True,'revoke_old_credentials_denies':True},identity_cases=checks)
(Path(__file__).resolve().parent / 'results.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
