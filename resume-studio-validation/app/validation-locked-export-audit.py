import argparse,hashlib,json,pathlib
import fitz
p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=pathlib.Path);p.add_argument('--runner-sha',required=True);a=p.parse_args()
r=a.root;e=json.loads((r/'locked-export-evidence.json').read_text(encoding='utf-8'))
assert e['runnerSha']==a.runner_sha and all(e['checks'].values())
expected={'locked-resume.pdf':'Synthetic Locked Candidate','locked-alpha.pdf':'SYNTHETIC_LOCKED_ALPHA','locked-beta.pdf':'SYNTHETIC_LOCKED_BETA','locked-original.pdf':'Synthetic Locked Original'}
rows={}
for f,marker in expected.items():
    path=r/f;digest=hashlib.sha256(path.read_bytes()).hexdigest()
    target=e['observations']['originalSha256'] if f=='locked-original.pdf' else next(x['sha256'] for x in e['observations']['outputs'] if x['name']==f)
    assert digest==target
    with fitz.open(path) as pdf:
        assert len(pdf)>=1 and marker in ''.join(p.get_text() for p in pdf),(f,marker)
        rows[f]={'pages':len(pdf),'sha256':digest}
assert len(set(x['sha256'] for x in rows.values()))==4
(r/'locked-export-audit.json').write_text(json.dumps({'runnerSha':a.runner_sha,'allFourActualPdfsVerified':True,'files':rows},indent=2),encoding='utf-8')
print(json.dumps(rows))
