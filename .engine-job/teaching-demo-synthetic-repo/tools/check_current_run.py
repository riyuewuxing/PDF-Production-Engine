"""Single formal machine gate for the current teaching-demo product.

All shared publication/QA policy comes from the selected product contract. The
lesson manifest contains only lesson-varying assertions and locked source facts.
Visual render success still requires separate human page-by-page inspection.
"""
from pathlib import Path
import argparse
import os,re,subprocess,sys,yaml
from pypdf import PdfReader
from board_contract import selftest as board_contract_selftest
from check_generalization_architecture import architecture_errors,selftest as architecture_selftest
from check_tooling_routes import route_errors,selftest as tooling_route_selftest
from latex_inline import selftest as inline_selftest
from physics_figures import selftest as figure_registry_selftest
from physics_notation import lint_text,selftest as notation_selftest
from skeleton_density import selftest as density_selftest,validate as validate_density
import publisher_core as core

ROOT=Path(__file__).resolve().parents[1]
_parser=argparse.ArgumentParser(add_help=False); _parser.add_argument('--manifest',default=None); _args,_unknown=_parser.parse_known_args()
if _args.manifest: core.configure_manifest(_args.manifest)
CFG=yaml.safe_load(core.MANIFEST.read_text(encoding='utf-8')) or {}
WORK=ROOT/str(CFG.get('workspace') or '')
TEX_DIR=core.OUT_TEX; PDF_DIR=core.OUT_PDF; errors=[]
try:
    core.product_contract_selftest(); CONTRACT=core.load_product_contract(CFG); errors.extend(core.validate_manifest_binding(CFG,CONTRACT))
except Exception as exc:
    CONTRACT={}; errors.append('PRODUCT_CONTRACT_GATE_FAILED: '+repr(exc))
QA=core.qa_policy(CONTRACT) if CONTRACT else {}; PUB=core.publication_policy(CONTRACT) if CONTRACT else {}; SOURCE_POLICY=core.source_policy(CONTRACT) if CONTRACT else {}; C=CFG.get('constraints') or {}

def page_texts(pdf):
    out=[]
    for n in range(1,len(PdfReader(str(pdf)).pages)+1):
        p=subprocess.run(['pdftotext','-f',str(n),'-l',str(n),str(pdf),'-'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True); out.append(p.stdout if p.returncode==0 else '')
    return out

def compiled_text(pdf): return subprocess.run(['pdftotext',str(pdf),'-'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True).stdout
def compact(text): return re.sub(r'\s+','',text)

def check_global(path):
    tex=path.read_text(encoding='utf-8')
    if r'\documentclass[UTF8,10pt]{article}' not in tex: errors.append(f'LEGACY_DOCUMENTCLASS_MISSING: {path.name}')
    for token in ('left=2.5cm','right=2.5cm','top=2.5cm','bottom=2.5cm'):
        if token not in tex: errors.append(f'LEGACY_MARGIN_DRIFT: {path.name}: {token}')
    spreads=re.findall(r'\\linespread\{([^}]+)\}',tex)
    if not spreads or any(x.strip()!='1.6' for x in spreads): errors.append(f'LOCAL_LINE_SPREAD_COMPRESSION: {path.name}: {spreads}')
    for token in (r'\small\linespread',r'\footnotesize\linespread',r'\scriptsize\linespread','left=2.15cm','right=2.15cm',r'\linespread{1.08}',r'\linespread{1.18}',r'\linespread{1.24}',r'\linespread{1.42}'):
        if token in tex: errors.append(f'VISUAL_BASELINE_COMPRESSION_LEAK: {path.name}: {token}')
    if '**' in tex: errors.append(f'MARKDOWN_BOLD_LEAK: {path.name}')

def source_roles():
    roles=set()
    for doc in (CONTRACT.get('documents') or {}).values():
        if doc.get('source_role'): roles.add(str(doc['source_role']))
        for section in doc.get('sections') or []:
            if section.get('source_role'): roles.add(str(section['source_role']))
    return roles

def section_for_qa(key):
    role=QA.get(key)
    if not role: errors.append(f'PRODUCT_QA_SECTION_ROLE_MISSING: {key}'); return None
    try: return core.contract_section(CONTRACT,str(role))
    except Exception as exc: errors.append(f'PRODUCT_QA_SECTION_RESOLUTION_FAILED: {key}: {exc}'); return None

def section_text(key):
    section=section_for_qa(key)
    if not section: return ''
    role=section.get('source_role'); rel=(CFG.get('source') or {}).get(role)
    if not rel: errors.append(f'PRODUCT_QA_SECTION_SOURCE_MISSING: {key}: {role!r}'); return ''
    path=WORK/str(rel)
    if not path.exists(): errors.append(f'PRODUCT_QA_SECTION_SOURCE_FILE_MISSING: {key}: {path.name}'); return ''
    return path.read_text(encoding='utf-8')

def training_doc():
    try: return core.contract_document_for_deliverable(CONTRACT,str(QA.get('training_deliverable_role')))[1]
    except Exception as exc: errors.append('TRAINING_DOCUMENT_RESOLUTION_FAILED: '+repr(exc)); return {}

def engineering_patterns():
    pats=[str(x) for x in PUB.get('forbidden_engineering_regexes') or []]
    if PUB.get('forbid_case_id_leak') and CFG.get('case_id'): pats.append(re.escape(str(CFG['case_id'])))
    return pats

def expected_sync_markers(doc):
    markers=[]
    for section in doc.get('sections') or []:
        if not section.get('consume_board_markers'): continue
        rel=(CFG.get('source') or {}).get(section.get('source_role'))
        if rel and (WORK/str(rel)).exists(): markers.extend(re.findall(r'\[\[BOARD:(P\d+)\]\]',(WORK/str(rel)).read_text(encoding='utf-8')))
    return markers

try: tooling_route_selftest(); errors.extend(route_errors(ROOT))
except Exception as exc: errors.append('TOOLING_ROUTE_GATE_FAILED: '+repr(exc))
try: architecture_selftest(); errors.extend(architecture_errors(ROOT))
except Exception as exc: errors.append('GENERALIZATION_ARCHITECTURE_GATE_FAILED: '+repr(exc))
try: board_contract_selftest(); density_selftest(); notation_selftest(); inline_selftest(); figure_registry_selftest()
except Exception as exc: errors.append('SHARED_COMPONENT_SELFTEST_FAILED: '+repr(exc))

sp=(CFG.get('input') or {}).get('source_pages') or {}
if SOURCE_POLICY.get('require_locked_identity'):
    for key in ('repo','ref','path','blob_sha','size_bytes','pages'):
        if not sp.get(key): errors.append('REMOTE_SOURCE_LOCK_MISSING: '+key)
    if sp.get('ref') and not re.fullmatch(r'[0-9a-f]{40}',str(sp['ref'])): errors.append('REMOTE_SOURCE_REF_NOT_COMMIT_SHA')
    if sp.get('blob_sha') and not re.fullmatch(r'[0-9a-f]{40}',str(sp['blob_sha'])): errors.append('REMOTE_SOURCE_BLOB_SHA_INVALID')
    if sp.get('path') and not str(sp['path']).lower().endswith('.pdf'): errors.append('REMOTE_SOURCE_PATH_NOT_PDF')
    if sp.get('size_bytes') and int(sp['size_bytes'])<100000: errors.append('REMOTE_SOURCE_SIZE_SUSPICIOUS')
if SOURCE_POLICY.get('require_resilient_transport'):
    try:
        import build_current_run as publisher
        publisher.source_transport_selftest(); names=[x[0] for x in publisher._remote_pdf_candidates(sp)]
        if len(names)<3 or 'github-media' not in names or 'github-api-raw' not in names: errors.append('REMOTE_SOURCE_TRANSPORT_REDUNDANCY_MISSING: '+repr(names))
    except Exception as exc: errors.append('REMOTE_SOURCE_TRANSPORT_SELFTEST_FAILED: '+repr(exc))
if SOURCE_POLICY.get('require_source_pages') and not sp.get('mode'): errors.append('SOURCE_PAGES_NOT_CONFIGURED')

docs=CONTRACT.get('documents') or {}; deliverables=CFG.get('deliverables') or {}; expected=[]
for doc in docs.values():
    role=doc.get('deliverable_role')
    if role in deliverables: expected.append(PDF_DIR/str(deliverables[role]))
actual=sorted(PDF_DIR.glob('*.pdf')) if PDF_DIR.exists() else []
if len(actual)!=len(docs): errors.append(f'DELIVERABLE_OUTPUT_COUNT: got {len(actual)}, expected {len(docs)}')
for p in expected:
    if not p.exists(): errors.append(f'MISSING_DELIVERABLE: {p.name}'); continue
    reader=PdfReader(str(p)); creator=str((reader.metadata or {}).get('/Creator','')); publisher=str(PUB.get('publisher') or '')
    if publisher and publisher not in creator: errors.append(f'PDF_PUBLISHER_DRIFT: {p.name}: creator={creator!r}, expected~={publisher!r}')
    for page in reader.pages:
        w,h=float(page.mediabox.width),float(page.mediabox.height)
        if not(590<=w<=600 and 838<=h<=846): errors.append(f'NOT_A4: {p.name}: {w:.1f}x{h:.1f}'); break
tex_files=sorted(TEX_DIR.glob('*.tex')) if TEX_DIR.exists() else []
if len(tex_files)!=len(docs): errors.append(f'TEX_SOURCE_COUNT: expected {len(docs)}, got {len(tex_files)}')
if PUB.get('require_global_typography'):
    for p in tex_files: check_global(p)

prov_path=TEX_DIR/'source-provenance.yaml'; prov=yaml.safe_load(prov_path.read_text(encoding='utf-8')) if prov_path.exists() else {}
if not prov: errors.append('SOURCE_PROVENANCE_MISSING')
else:
    if prov.get('configured_mode')!=sp.get('mode'): errors.append('SOURCE_PROVENANCE_MODE_DRIFT')
    printed=list((CFG.get('input') or {}).get('printed_pages') or [])
    if int(prov.get('page_count') or -1)!=len(printed): errors.append(f'SOURCE_PROVENANCE_PAGE_COUNT: {prov.get("page_count")} != {len(printed)}')
    if sp.get('blob_sha') and prov.get('expected_blob_sha')!=sp.get('blob_sha'): errors.append('SOURCE_PROVENANCE_BLOB_DRIFT')
    allow_offline=os.environ.get('QZ_ALLOW_OFFLINE_REGRESSION')=='1'
    if not prov.get('canonical_source') and not allow_offline: errors.append('NON_CANONICAL_SOURCE_PAGES: offline override cannot pass formal gate')
    if prov.get('canonical_source') and sp.get('mode')=='remote-pdf' and sp.get('blob_sha') and prov.get('actual_blob_sha')!=sp.get('blob_sha'): errors.append('CANONICAL_SOURCE_BLOB_NOT_VERIFIED')

evidence_path=WORK/str((CFG.get('source') or {}).get('evidence')); evidence=yaml.safe_load(evidence_path.read_text(encoding='utf-8')) if evidence_path.exists() else {}; locator=evidence.get('source_locator') or {}
for key in ('repo','ref','blob_sha'):
    if sp.get(key) and locator.get(key)!=sp.get(key): errors.append(f'SOURCE_LOCATOR_DRIFT: {key}')
if sp.get('pages') and list(locator.get('pdf_pages') or [])!=list(sp.get('pages') or []): errors.append('SOURCE_LOCATOR_DRIFT: pdf_pages')
if list(evidence.get('printed_pages') or [])!=list((CFG.get('input') or {}).get('printed_pages') or []): errors.append('SOURCE_LOCATOR_DRIFT: printed_pages')

if PUB.get('require_symbol_notation_lint'):
    for role in sorted(source_roles()):
        rel=(CFG.get('source') or {}).get(role); p=WORK/str(rel) if rel else None
        if p and p.exists():
            for issue in lint_text(p.read_text(encoding='utf-8'),require_math_mode=True): errors.append(f'{issue.code}: {p.name}: ${issue.fragment}$')
    board_rel=(CFG.get('source') or {}).get('board')
    if board_rel:
        for issue in lint_text((WORK/str(board_rel)).read_text(encoding='utf-8'),require_math_mode=True): errors.append(f'{issue.code}: BOARD_PLAN.yaml: ${issue.fragment}$')
    for p in tex_files:
        for issue in lint_text(p.read_text(encoding='utf-8'),require_math_mode=False): errors.append(f'{issue.code}: generated:{p.name}: ${issue.fragment}$')

skeleton=section_text('skeleton_section_role'); metrics,density_issues=validate_density(skeleton,QA.get('skeleton_density') or {})
for issue in density_issues: errors.append(f'{issue.code}: exam_skeleton: {issue.detail}')
for pattern in engineering_patterns():
    if re.search(pattern,skeleton): errors.append(f'ENGINEERING_LABEL_IN_EXAM_SKELETON: {pattern}')

board_rel=(CFG.get('source') or {}).get('board'); board_data=yaml.safe_load((WORK/str(board_rel)).read_text(encoding='utf-8')) if board_rel else {}; board_case=next((c for c in (board_data or {}).get('cases') or [] if c.get('id')==CFG.get('case_id')),None)
if not board_case: errors.append('BOARD_CASE_MISSING')
else:
    if not board_case.get('layout'): errors.append('BOARD_LAYOUT_MISSING')
    if len(board_case.get('sections') or [])<int(C.get('board_sections_min',1)): errors.append('BOARD_SECTIONS_TOO_FEW')
    for point,item in (board_case.get('increments') or {}).items():
        if isinstance(item,dict) and (not item.get('label') or not item.get('text')): errors.append(f'BOARD_INCREMENT_INCOMPLETE: {point}')

tdoc=training_doc(); training_sources=[]
for section in tdoc.get('sections') or []:
    if section.get('renderer')=='markdown' and section.get('source_role'):
        rel=(CFG.get('source') or {}).get(section['source_role'])
        if rel and (WORK/str(rel)).exists(): training_sources.append((WORK/str(rel)).read_text(encoding='utf-8'))
combined='\n'.join(training_sources); figure_min=int(C.get('figure_count_min',0)); figure_markers=len(re.findall(r'\[\[FIGURE:[a-z0-9-]+\]\]',combined))
if figure_markers<figure_min: errors.append(f'FIGURE_MARKERS_TOO_FEW: {figure_markers} < {figure_min}')

defense=section_text('defense_section_role'); dp=QA.get('defense_questions') or {}; qcount=len(re.findall(str(dp.get('heading_regex') or r'^###\s+'),defense,flags=re.M)); lo=int(dp.get('min',0)); hi=int(dp.get('max',10**9))
if not lo<=qcount<=hi: errors.append(f'DEFENSE_QUESTION_COUNT: {qcount} not in [{lo},{hi}]')
hp=QA.get('homework_solution') or {}; homework=section_text('homework_solution_section_role'); token=str(hp.get('token') or '')
if hp.get('required') and token not in homework: errors.append(f'HOMEWORK_SOLUTION_MISSING: {token}')

for p in expected:
    if not p.exists(): continue
    proc=subprocess.run(['pdffonts',str(p)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    if proc.returncode: errors.append(f'PDFFONTS_FAILED: {p.name}')
    else:
        rows=[line for line in proc.stdout.splitlines() if line.strip() and not line.startswith('name') and not line.startswith('---')]
        for line in rows:
            parts=line.split()
            if len(parts)>=5 and parts[4].lower()=='no': errors.append(f'FONT_NOT_EMBEDDED: {p.name}: {line}')
    text=compiled_text(p)
    for leak in ['[[BOARD:','[[FIGURE:','<!--PAGEBREAK-->','PAGEBREAK','**']:
        if leak in text: errors.append(f'SOURCE_MARKER_LEAK: {p.name}: {leak}')
    for pattern in engineering_patterns():
        if re.search(pattern,text): errors.append(f'ENGINEERING_LABEL_LEAK: {p.name}: {pattern}')

training_role=QA.get('training_deliverable_role'); training_name=deliverables.get(training_role); training_pdf=PDF_DIR/str(training_name) if training_name else None
if training_pdf and training_pdf.exists() and tdoc:
    text=compiled_text(training_pdf)
    for section_role in QA.get('required_training_section_roles') or []:
        try: heading=core.contract_section(CONTRACT,str(section_role))['heading']
        except Exception as exc: errors.append(f'TRAINING_REQUIRED_ROLE_RESOLUTION_FAILED: {section_role}: {exc}'); continue
        if str(heading) not in text: errors.append(f'TRAINING_REQUIRED_SECTION_MISSING: {section_role}: {heading}')
    expected_total=core.expected_total_board_copies(CONTRACT)
    if text.count('总板书')<expected_total: errors.append(f'TOTAL_BOARD_COPIES_MISSING: {text.count("总板书")}<{expected_total}')
    markers=expected_sync_markers(tdoc)
    if board_case:
        missing=[m for m in markers if m not in (board_case.get('increments') or {})]
        if missing: errors.append('SYNC_BOARD_MARKER_UNRESOLVED: '+repr(missing))
    if text.count('同步板书')<len(markers): errors.append(f'SYNC_BOARD_COUNT_MISSING: {text.count("同步板书")}<{len(markers)}')
    if hp.get('required') and token not in text: errors.append(f'HOMEWORK_SOLUTION_NOT_PUBLISHED: {token}')
    if QA.get('require_training_section_new_page'):
        pages=page_texts(training_pdf); normalized=[compact(t) for t in pages]; section_pages={}
        for section in tdoc.get('sections') or []:
            heading=str(section['heading']); key=compact(heading); page_no=next((i for i,t in enumerate(normalized,1) if key in t),None)
            if page_no is None: errors.append(f'TOP_LEVEL_SECTION_NOT_FOUND: {section.get("role")}: {heading}')
            section_pages[str(section['role'])]=page_no
        ordered=[section_pages.get(str(s['role'])) for s in tdoc.get('sections') or []]; actual_pages=[x for x in ordered if x is not None]
        if len(actual_pages)==len(ordered):
            if actual_pages!=sorted(actual_pages): errors.append(f'TOP_LEVEL_SECTION_ORDER_INVALID: {ordered}')
            if len(set(actual_pages))!=len(actual_pages): errors.append(f'TOP_LEVEL_SECTION_PAGE_COLLISION: {ordered}')
        sk=section_pages.get(str(QA.get('skeleton_section_role'))); tr=section_pages.get(str(QA.get('trial_section_role'))); max_span=QA.get('exam_skeleton_section_pages_max')
        if max_span is not None and sk and tr and tr-sk>int(max_span): errors.append(f'EXAM_SKELETON_SECTION_SPILL: pages {sk}..{tr-1}')

training_tex=TEX_DIR/str(tdoc.get('tex_filename')) if tdoc else None
if training_tex and training_tex.exists():
    tex=training_tex.read_text(encoding='utf-8'); panels=tex.count(r'\begin{figurepanel}')
    if panels<figure_min: errors.append(f'PUBLISHED_FIGURE_COUNT_TOO_LOW: {panels} < {figure_min}')
    if r'\begin{totalboard}' not in tex: errors.append('STRUCTURED_TOTAL_BOARD_MISSING')
    if r'\textbf{' not in tex: errors.append('BOLD_MARKUP_NOT_RENDERED')

exrole=QA.get('extraction_deliverable_role'); exname=deliverables.get(exrole); expdf=PDF_DIR/str(exname) if exname else None
if expdf and expdf.exists():
    text=compiled_text(expdf)
    for required in QA.get('required_extraction_sections') or []:
        if str(required) not in text: errors.append(f'EXTRACTION_REQUIRED_SECTION_MISSING: {required}')

if errors:
    print('\n'.join(errors)); sys.exit(1)
print('formal current-run machine gate: PASS'); print('skeleton density metrics:',metrics); sys.exit(0)
