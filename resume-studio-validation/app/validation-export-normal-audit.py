import argparse,hashlib,json,pathlib
import fitz
p=argparse.ArgumentParser()
p.add_argument('--root',required=True)
p.add_argument('--runner-sha',required=True)
a=p.parse_args()
root=pathlib.Path(a.root)
e=json.loads((root/'export-scenario.json').read_text(encoding='utf-8'))
assert e['runnerSha']==a.runner_sha and all(e['checks'].values())
expected=[('ordinary.pdf','Synthetic Receipt Candidate',e['observations']['normal']),('archived-source.pdf','Synthetic Receipt Candidate',e['observations']['archivedSource']),('letter-alpha.pdf','SYNTHETIC_LETTER_ALPHA',e['observations']['letters'][0]),('letter-beta.pdf','SYNTHETIC_LETTER_BETA',e['observations']['letters'][1])]
results={}
for name,marker,meta in expected:
    raw=(root/name).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==meta['sha256']
    with fitz.open(root/name) as d:
        text=' '.join(page.get_text() for page in d)
        assert marker in text,(name,marker)
        if name=='letter-alpha.pdf': assert 'SYNTHETIC_LETTER_BETA' not in text
        if name=='letter-beta.pdf': assert 'SYNTHETIC_LETTER_ALPHA' not in text
        results[name]={'pages':len(d),'expectedText':True,'sha256':meta['sha256']}
(root/'export-scenario-audit.json').write_text(json.dumps({'runnerSha':a.runner_sha,'results':results},indent=2),encoding='utf-8')
