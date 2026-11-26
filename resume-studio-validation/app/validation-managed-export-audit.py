import argparse, base64, hashlib, json, pathlib, zipfile
from html.parser import HTMLParser
import fitz
p=argparse.ArgumentParser()
p.add_argument('--root',required=True)
p.add_argument('--runner-sha',required=True)
args=p.parse_args()
root=pathlib.Path(args.root)
e=json.loads((root/'managed-export-evidence.json').read_text(encoding='utf-8'))
assert e['runnerSha']==args.runner_sha and all(e['checks'].values())
def magenta(pix):
    if pix.colorspace is None or pix.colorspace.n!=3:
        pix=fitz.Pixmap(fitz.csRGB,pix)
    b=pix.samples;n=pix.n
    return sum(1 for i in range(0,len(b),n) if b[i]>=220 and b[i+1]<=45 and b[i+2]>=220)
class Photos(HTMLParser):
    def __init__(self): super().__init__(); self.sources=[]
    def handle_starttag(self,tag,attrs):
        if tag=='img':
            self.sources.append(dict(attrs).get('src',''))
def image_count(data):
    return magenta(fitz.Pixmap(data))
results={}
for label in ('ordinary','linked'):
    row={}
    for ext in ('pdf','png','docx','html'):
        name=label+'.'+ext
        f=root/name; data=f.read_bytes()
        assert hashlib.sha256(data).hexdigest()==e['files'][name]['sha256']
        if ext=='pdf':
            with fitz.open(f) as d:
                assert len(d)>=1
                text=''.join(page.get_text() for page in d)
                assert 'Synthetic Marker Candidate' in text
                row[ext]={'magentaPixels':sum(magenta(page.get_pixmap(matrix=fitz.Matrix(1.2,1.2),colorspace=fitz.csRGB)) for page in d),'pages':len(d)}
        elif ext=='png':
            row[ext]={'magentaPixels':image_count(data)}
        elif ext=='docx':
            with zipfile.ZipFile(f) as z:
                assert z.testzip() is None
                images=[z.read(n) for n in z.namelist() if n.startswith('word/media/') and not n.endswith('/')]
                assert 'Synthetic Marker Candidate' in z.read('word/document.xml').decode('utf-8')
                row[ext]={'magentaPixels':sum(image_count(i) for i in images),'mediaCount':len(images),'markerExactBytes':any(hashlib.sha256(i).hexdigest()==e['files']['marker']['sha256'] for i in images)}
        else:
            parser=Photos();parser.feed(data.decode('utf-8'))
            imgs=[base64.b64decode(src.split(',',1)[1],validate=True) for src in parser.sources if src.startswith('data:image/')]
            assert all(src.startswith('data:image/') for src in parser.sources)
            assert b'Synthetic Marker Candidate' in data
            assert b'linked-portrait.png' not in data
            row[ext]={'magentaPixels':sum(image_count(i) for i in imgs),'embeddedCount':len(imgs),'markerExactBytes':any(hashlib.sha256(i).hexdigest()==e['files']['marker']['sha256'] for i in imgs)}
    results[label]=row
for ext in ('pdf','png','docx','html'):
    assert results['ordinary'][ext]['magentaPixels']>100, (ext, 'ordinary portrait absent',results)
    assert results['linked'][ext]['magentaPixels']==0,(ext,'linked external portrait present',results)
assert results['ordinary']['docx']['markerExactBytes'] and results['ordinary']['html']['markerExactBytes']
assert results['linked']['docx']['mediaCount']==0 and results['linked']['html']['embeddedCount']==0
(root/'managed-export-audit.json').write_text(json.dumps({'runnerSha':args.runner_sha,'privateBaseSha':e['privateBaseSha'],'checks':{'actualPdfPositiveNegative':True,'actualPngPositiveNegative':True,'actualDocxPositiveNegative':True,'actualHtmlPositiveNegative':True},'results':results},indent=2),encoding='utf-8')
print(json.dumps(results))
