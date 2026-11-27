import argparse,json,pathlib,zipfile,hashlib,fitz,xml.etree.ElementTree as ET
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--runner-sha',required=True);a=p.parse_args()
root=pathlib.Path(a.root);report={'runnerSha':a.runner_sha,'checks':{},'files':{}}
def check(text,kind):
    for item in ('Alpha Academy','Beta Academy','corrected@example.invalid','Corrected Honor','Table Cell A','Table Cell B','Visible link label'):
        assert item in text,(kind,'missing',item)
    for item in ('UNCLASSIFIED_DOCX_37','HEADER_PRIVATE_MARKER_37','FOOTER_PRIVATE_MARKER_37','DO_NOT_FETCH_DOCX_37','docx@example.invalid'):
        assert item not in text,(kind,'leak',item)
    report['checks'][kind+'VisibleAndHiddenBoundary']=True
for ext in ('html','md'):
    check((root/f'actual-docx-import-export.{ext}').read_text(encoding='utf-8'),ext)
with zipfile.ZipFile(root/'actual-docx-import-export.docx') as z:
    assert z.testzip() is None
    check('\n'.join(z.read(n).decode('utf-8') for n in z.namelist() if n.endswith('.xml')), 'docx')
    w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    d=ET.fromstring(z.read('word/document.xml'))
    outline=[]
    for para in d.iter(w+'p'):
        lvl=para.find('./'+w+'pPr/'+w+'outlineLvl')
        if lvl is not None:outline.append((lvl.get(w+'val'),''.join(n.text or '' for n in para.iter(w+'t'))))
    assert ('1','Alpha Academy') in outline and ('1','Beta Academy') in outline,outline
    report['checks']['semanticOutlinePreserved']=True
with fitz.open(root/'actual-docx-import-export.pdf') as doc:
    check('\n'.join(pg.get_text() for pg in doc),'pdf')
    doc[0].get_pixmap(matrix=fitz.Matrix(1.4,1.4)).save(root/'actual-docx-import-export-render.png')
    report['pdfPages']=len(doc)
for f in sorted(root.glob('actual-docx-import-export.*')):
    report['files'][f.name]={'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'size':f.stat().st_size}
(root/'docx-export-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
