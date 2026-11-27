import argparse,hashlib,json,pathlib
import fitz
p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=pathlib.Path);p.add_argument('--runner-sha',required=True);a=p.parse_args()
r=a.root;e=json.loads((r/'version-race-evidence.json').read_text(encoding='utf-8'))
assert e['runnerSha']==a.runner_sha and all(e['checks'].values())
def marker_count(pix):
    b=pix.samples;n=pix.n
    return sum(1 for i in range(0,len(b),n) if b[i]>=220 and b[i+1]<=45 and b[i+2]>=220)
results={}
for key,name,other in [('first','First','Second'),('second','Second','First')]:
    f=r/(key+'-version.pdf');b=f.read_bytes();assert hashlib.sha256(b).hexdigest()==e['files'][key]['sha256']
    with fitz.open(f) as d:
        text=''.join(pg.get_text() for pg in d)
        assert 'Synthetic '+name+' Version Marker' in text and 'Synthetic '+other+' Version Marker' not in text
        pixels=sum(marker_count(pg.get_pixmap(colorspace=fitz.csRGB)) for pg in d)
        assert (pixels>100 if key=='first' else pixels==0)
        results[key]={'pages':len(d),'portraitPixels':pixels,'correctSourceText':True}
(r/'version-race-audit.json').write_text(json.dumps({'runnerSha':a.runner_sha,'actualPdfIdentityVerified':True,'results':results},indent=2),encoding='utf-8')
print(json.dumps(results))
