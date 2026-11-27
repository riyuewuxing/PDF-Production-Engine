import argparse,hashlib,json,pathlib
import fitz
from importlib import import_module
p=argparse.ArgumentParser()
p.add_argument('--root',required=True,type=pathlib.Path)
p.add_argument('--locale',required=True)
p.add_argument('--source-sha',required=True)
p.add_argument('--runner-sha',required=True)
a=p.parse_args();root=a.root
m=json.loads((root/'matrix-manifest.json').read_text(encoding='utf-8'))
assert m['runnerSha']==a.runner_sha and m['sourceSha']==a.source_sha and m['locale']==a.locale
assert m['complete'] and m['registryCount']==51 and len(m['cases'])==51
assert m['freeze']['assetReadCount']==1 and all(m['freeze'][k] for k in ['sourceReferencePreserved','historyReferencePreserved','replacementPreserved'])
def compare(f,g):
    pages=[]
    with fitz.open(f) as d,fitz.open(g) as ref:
        assert len(d)==len(ref) and len(d)>0
        for i,(x,y) in enumerate(zip(d,ref)):
            assert x.get_text()==y.get_text(), (f.name,i,'text')
            assert x.rect==y.rect, (f.name,i,'dimensions')
            u=x.get_pixmap(colorspace=fitz.csRGB);v=y.get_pixmap(colorspace=fitz.csRGB)
            assert (u.width,u.height,u.n)==(v.width,v.height,v.n)
            assert u.samples==v.samples,(f.name,i,'pixels')
            pages.append(hashlib.sha256(u.samples).hexdigest())
    return pages
rows={}
for c in m['cases']:
    assert c['status']=='rendered'
    rows[c['templateId']]=compare(root/c['file'],root/c['reference'])
freeze=compare(root/'freeze-actual.pdf',root/'freeze-reference.pdf')
result={'runnerSha':a.runner_sha,'locale':a.locale,'exactTextAndPixels':len(rows),'pageCount':sum(map(len,rows.values())),'freezeExact':True,'freezePages':len(freeze),'pages':rows}
(root/'portrait-matrix-comparison.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='pages'}))
