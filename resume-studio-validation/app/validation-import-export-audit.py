import argparse, json, pathlib, zipfile, hashlib, fitz
p=argparse.ArgumentParser()
p.add_argument('--root',required=True)
p.add_argument('--runner-sha',required=True)
a=p.parse_args()
root=pathlib.Path(a.root)
report={'runnerSha':a.runner_sha,'checks':{},'files':{}}
marker='UNCLASSIFIED_PUBLICATION_36'
old='demo@example.invalid'
def validate_text(t,kind):
    for expected in ('Alpha Academy','Beta Academy','corrected@example.invalid','Corrected Honor'):
        assert expected in t,(kind,'missing expected visible text',expected)
    assert marker not in t and old not in t,(kind,'hidden source leaked')
    report['checks'][kind+'VisibleAndHiddenBoundary']=True
for ext in ('html','md'):
    f=root/f'actual-import-export.{ext}'
    validate_text(f.read_text(encoding='utf-8'),ext)
with zipfile.ZipFile(root/'actual-import-export.docx') as z:
    assert z.testzip() is None
    all_xml='\n'.join(z.read(n).decode('utf-8') for n in z.namelist() if n.endswith('.xml'))
    validate_text(all_xml,'docx')
with fitz.open(root/'actual-import-export.pdf') as doc:
    assert len(doc)>=1
    validate_text('\n'.join(pg.get_text() for pg in doc),'pdf')
    doc[0].get_pixmap(matrix=fitz.Matrix(1.4,1.4)).save(root/'actual-import-export-render.png')
    report['pdfPages']=len(doc)
with fitz.open(root/'synthetic-31-pages.pdf') as doc:
    assert len(doc)==31,('bad page cap fixture',len(doc))
    report['checks']['actual31PageFixture']=True
for f in sorted(root.glob('actual-import-export.*')):
    report['files'][f.name]={'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'size':f.stat().st_size}
(root/'import-export-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
