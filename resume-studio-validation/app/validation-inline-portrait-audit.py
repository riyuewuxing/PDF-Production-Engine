import argparse,base64,hashlib,json,pathlib,zipfile
from html.parser import HTMLParser
import fitz
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--runner-sha',required=True);a=p.parse_args()
r=pathlib.Path(a.root);e=json.loads((r/'inline-evidence.json').read_text(encoding='utf-8'))
assert e['runnerSha']==a.runner_sha and e['phase']=='fixed' and e['checks']['actualExportCount']==48
assert all(e['checks'].values()) and e['files']['ui']=={'quick':False,'warned':True}
def pixels(pix):
    if pix.colorspace is None or pix.colorspace.n!=3:pix=fitz.Pixmap(fitz.csRGB,pix)
    b=pix.samples;n=pix.n
    return sum(1 for i in range(0,len(b),n) if b[i]>=220 and b[i+1]<=45 and b[i+2]>=220)
class Photos(HTMLParser):
    def __init__(self):super().__init__();self.sources=[]
    def handle_starttag(self,tag,attrs):
        if tag=='img':self.sources.append(dict(attrs).get('src',''))
def digest(b):return hashlib.sha256(b).hexdigest()
results={}
for label in ['good-png','good-jpg','good-webp','good-wrapped','corrupt-png','corrupt-jpg','header-png','header-jpg','empty-png','corrupt-webp','managed-header-png','managed-header-jpg']:
    row={};good=label.startswith('good-')
    for ext in ['pdf','png','docx','html']:
        file=r/(label+'-out.'+ext);b=file.read_bytes();info=e['files'][file.name]
        assert digest(b)==info['sha256']
        assert (info['warning'] is None if good else '无法解码' in info['warning'])
        if ext=='pdf':
            with fitz.open(file) as d:
                assert 'Synthetic Inline Candidate' in ''.join(pg.get_text() for pg in d)
                value=sum(pixels(pg.get_pixmap(matrix=fitz.Matrix(1.2,1.2),colorspace=fitz.csRGB)) for pg in d)
            row[ext]={'pixels':value}
        elif ext=='png':row[ext]={'pixels':pixels(fitz.Pixmap(b))}
        elif ext=='docx':
            with zipfile.ZipFile(file) as z:
                assert z.testzip() is None
                assert 'Synthetic Inline Candidate' in z.read('word/document.xml').decode('utf-8')
                images=[z.read(n) for n in z.namelist() if n.startswith('word/media/') and not n.endswith('/')]
            row[ext]={'pixels':sum(pixels(fitz.Pixmap(i)) for i in images),'images':len(images)}
        else:
            parser=Photos();parser.feed(b.decode('utf-8'))
            assert b'Synthetic Inline Candidate' in b
            assert all(s.startswith('data:image/') for s in parser.sources)
            images=[base64.b64decode(s.split(',',1)[1],validate=True) for s in parser.sources]
            row[ext]={'pixels':sum(pixels(fitz.Pixmap(i)) for i in images),'images':len(images)}
        assert (row[ext]['pixels']>100 if good else row[ext]['pixels']==0),(label,ext,row)
        if ext in ['docx','html']:
            assert len(images)==(1 if good else 0)
            if label in ['good-png','good-jpg','good-wrapped']:
                assert digest(images[0])==e['files'][label]['inputHash']
    results[label]=row
(r/'inline-audit.json').write_text(json.dumps({'runnerSha':a.runner_sha,'results':results,'all48OutputAuditsPassed':True},indent=2),encoding='utf-8')
print(json.dumps(results))
