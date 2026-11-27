import {useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {apiClient,localErrorMessage} from '../../lib/apiClient';
import {careerLedger} from '../../lib/careerLedgerSession';
import {verifyQueueWorkflowOpen} from '../../lib/jobQueueWorkflow';
import {generateCoverLetterBundle} from '../../lib/jobToolkit';
import {visibleBasicValue} from '../../lib/aiContext';
import {resolveCoverLetterHeaderVariant} from '../../lib/careerExporter';
import {PdfArtifactReceiptSchema,SavedCoverLetterSchema,type JobQueueOpenResult,type JobApplication} from '../../schema/applicationSchema';
import {JobRequirementsPane} from '../Diagnose/JobRequirementsPane';
import {InterviewPracticePane} from './InterviewPracticePane';
import {QuickLogApplicationModal,type FrozenPdfExportSnapshot} from './QuickLogApplicationModal';
import type {ResumeDocument} from '../../schema/resumeSchema';
type Tab='review'|'letters'|'interview'|'materials';
const tabLabels:Record<Tab,string>={review:'JD 人工核对',letters:'自荐信 / 话术',interview:'岗位面试',materials:'PDF / 投递包'};
const btn='rounded border border-slate-300 bg-white px-2 py-1.5 font-medium text-slate-800 disabled:opacity-40';
const primary='rounded bg-teal-700 px-3 py-1.5 font-medium text-white disabled:opacity-40';
/** Dedicated in-memory session, never copies the job into the global diagnosis
 * draft or switches/edits the user's document. All persistent actions use the
 * existing ledger, export and immutable PDF-snapshot services. */
export function JobQueueWorkflowPane({opened,activeDoc,onExit}:{opened:JobQueueOpenResult;activeDoc:ResumeDocument;onExit:()=>void}){
  const {task,document}=opened;
  const ledger=useSyncExternalStore(careerLedger.subscribe,careerLedger.getSnapshot);
  const [tab,setTab]=useState<Tab>('review');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [invalid,setInvalid]=useState(false);
  const [snapshot,setSnapshot]=useState<(FrozenPdfExportSnapshot&{requestId:string})|null>(null),[logOpen,setLogOpen]=useState(false);
  const mounted=useRef(false),action=useRef(false),readBusy=useRef(false);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const clean=ledger.ready&&!ledger.loading&&!ledger.saving&&!ledger.dirty&&!ledger.error&&!!ledger.data.revision;
  const bundle=useMemo(()=>generateCoverLetterBundle(document,{company:task.company,role:task.role}),[document,task]);
  const [letter,setLetter]=useState(bundle.coverLetterText),[letterTitle,setLetterTitle]=useState('');
  const letters=ledger.data.coverLetters.filter(l=>l.queueTaskId===task.id);
  const applications=ledger.data.applications.filter(a=>a.queueTaskId===task.id);
  const archiveCount=ledger.data.jobReviews?.filter(a=>a.queueTaskId===task.id).length??0;
  const headerVariant=resolveCoverLetterHeaderVariant(document.templateId);
  const verify=async()=>{
    if(!mounted.current||invalid||readBusy.current)throw Error('岗位流程已失效或核验尚未结束。');
    const current=careerLedger.getSnapshot(),revision=current.data.revision;
    if(!current.ready||current.loading||current.saving||current.dirty||current.error||!revision||JSON.stringify(current.data.jobQueue?.find(t=>t.id===task.id))!==JSON.stringify(task))throw Error('台账尚未确认或任务已变化，请先处理草稿并重新核验。');
    readBusy.current=true;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const pending=apiClient.openPreparedJobQueue({taskId:task.id,ledgerRevision:revision});
    // Never free the read guard merely because the UI stopped waiting.
    void pending.then(()=>{readBusy.current=false;},()=>{readBusy.current=false;});
    try{
      const reply=await Promise.race([pending,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('岗位流程读取超过10秒，未继续操作。')),10000);})]);
      const checked=await verifyQueueWorkflowOpen(reply,task,revision,task.slug,activeDoc);
      if(!mounted.current||careerLedger.getSnapshot()!==current)throw Error('核验期间岗位流程或台账已变化，未继续操作。');
      return checked.document;
    }catch(e){
      // A failed disk verification must not leave an apparently usable session.
      if(mounted.current){setInvalid(true);setSnapshot(null);setLogOpen(false);setError(localErrorMessage(e,'岗位绑定核验失败'));}
      throw e;
    }finally{if(timer!==undefined)clearTimeout(timer);}
  };
  const run=async(work:()=>Promise<void>)=>{
    if(action.current||!mounted.current||invalid)return;
    action.current=true;setBusy(true);setError('');setNotice('');
    const watchdog=setTimeout(()=>{if(mounted.current)setNotice('操作超过60秒仍未确认；系统对话框或文件操作可能尚未结束，不会自动重试。');},60000);
    try{await work();}catch(e){if(mounted.current)setError(localErrorMessage(e,'岗位材料操作失败'));}
    finally{clearTimeout(watchdog);action.current=false;if(mounted.current)setBusy(false);}
  };
  const switchTab=(next:Tab)=>{if(next===tab||busy||logOpen)return;void run(async()=>{await verify();if(mounted.current)setTab(next);});};
  const saveLetter=()=>void run(async()=>{
    await verify();
    if(!letter.trim()||letter.length>50000)throw Error('自荐信正文须为非空且不超过50000字符。');
    const entry=SavedCoverLetterSchema.parse({id:crypto.randomUUID(),queueTaskId:task.id,title:letterTitle.trim()||task.company+'-'+task.role+'-'+new Date().toISOString().slice(0,10),company:task.company,role:task.role,resumeSlug:task.slug,bodyText:letter,headerVariant,updatedAt:new Date().toISOString()});
    if(!careerLedger.update(d=>({...d,coverLetters:[entry,...d.coverLetters]})))throw Error('台账未就绪，未保存。');
    await careerLedger.flush();
    const saved=careerLedger.getSnapshot();
    if(saved.dirty||saved.error||JSON.stringify(saved.data.coverLetters.find(l=>l.id===entry.id))!==JSON.stringify(entry))throw Error('自荐信未获得完整保存回执，请核对台账草稿。');
    if(mounted.current){setLetterTitle('');setNotice('已保存本岗位自荐信版本（未发送）。');}
  });
  const exportLetter=()=>void run(async()=>{
    const doc=await verify();
    if(!letter.trim()||letter.length>50000)throw Error('自荐信正文须为非空且不超过50000字符。');
    const result=await apiClient.exportCoverLetterPdf({payload:{title:'求职自荐信',company:task.company,role:task.role,candidateName:visibleBasicValue(doc,'name')||'求职者',candidateTitle:visibleBasicValue(doc,'title'),contactLine:[visibleBasicValue(doc,'name'),visibleBasicValue(doc,'phone'),visibleBasicValue(doc,'email')].filter(Boolean).join(' | '),bodyText:letter,themeColor:doc.globalSettings.themeColor||'#167883',fontFamily:doc.globalSettings.fontFamily,customFontFamily:doc.globalSettings.customFontFamily,headerVariant,dateText:new Date().toISOString().slice(0,10)}});
    if(mounted.current)setNotice(result.canceled?'已取消自荐信导出。':result.filePath?'自荐信已导出：'+result.filePath+'；未发送。':'自荐信输出路径未确认。');
  });
  const exportPdf=()=>void run(async()=>{
    const doc=await verify();setSnapshot(null);setLogOpen(false);
    // Pass the verified disk document, not a mutable editor draft; the existing
    // desktop PDF producer creates its normal history and actual byte receipt.
    const revision=careerLedger.getSnapshot().data.revision;
    if(!revision)throw Error('缺少已确认台账版本。');
    const result=await apiClient.exportPdf({slug:task.slug,document:doc,saveAs:false,skipSave:false,queueScope:{taskId:task.id,ledgerRevision:revision}});
    if(!mounted.current)return;
    if(result.canceled){setNotice('已取消导出。');return;}
    const receipt=PdfArtifactReceiptSchema.safeParse(result.pdfReceipt);
    if(!result.filePath||!receipt.success||!result.pdfReceiptToken||result.snapshotWarning||result.contentWarning||result.receiptWarning){setError('PDF 输出或原稿凭证未完整确认；可能已有文件，不能归档。'+[result.snapshotWarning,result.contentWarning,result.receiptWarning].filter(Boolean).join('；'));return;}
    try{await verify();}catch(e){if(mounted.current)setError('PDF 已输出，但岗位绑定复核失败，未开放归档：'+localErrorMessage(e,'核验失败'));return;}
    if(!mounted.current)return;
    setSnapshot({slug:task.slug,document:doc,isRedacted:false,filePath:result.filePath,pdfReceipt:receipt.data,pdfReceiptToken:result.pdfReceiptToken,requestId:crypto.randomUUID()});
    setNotice('原稿 PDF 已导出并取得字节凭证；尚未记入投递，未发送。');
  });
  const packagePdf=(entry:JobApplication)=>void run(async()=>{
    await verify();
    const current=careerLedger.getSnapshot(),item=current.data.applications.find(a=>a.id===entry.id);
    if(!item||item.queueTaskId!==task.id||!item.snapshotId||!item.pdfReceipt||!current.data.revision)throw Error('投递关联已变化，未制作投递包。');
    const result=await apiClient.exportApplicationPackage({applicationId:item.id,snapshotId:item.snapshotId,ledgerRevision:current.data.revision});
    if(mounted.current)setNotice(result.canceled?'已取消制作投递包。':'投递包已制作：'+result.filePath+'；'+result.entries.length+' 个 PDF；SHA-256 '+result.sha256+'；未发送。');
  });
  const disabled=busy||invalid||!clean||logOpen;
  return <section aria-label="固定岗位材料流程" className="space-y-3 break-words">
    <div className="rounded-lg border border-teal-300 bg-teal-50 p-3 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold text-teal-900">固定岗位材料流程</h3><button type="button" className={btn} disabled={busy||logOpen} onClick={onExit}>返回岗位队列</button></div>
      <p className="font-semibold">{task.company} · {task.role}</p>
      <p>绑定简历：{document.title} · {task.slug}</p>
      <p className="text-[10px] break-all">任务 ID：{task.id} · 原稿 SHA-256：{task.documentSha256}</p>
      <p>本地准备完成 ≠ 招聘资格、人工核对或已投递。原稿为进入时核验的磁盘版本；切换模块、保存或导出前重新核验。本流程不自动调用 AI、不修改简历、不发送材料。</p>
      <details><summary>固定 JD 原文（{task.jdText.length} 字）</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px]">{task.jdText}</pre></details>
      <p className="text-[11px] text-slate-700">已保存核对档案 {archiveCount} · 自荐信 {letters.length} · PDF归档 {applications.length}。这些是记录数量，不是流程通过率。离开或切换模块会丢弃未归档的核对会话；保存的历史保留。</p>
    </div>
    {invalid&&<p role="alert" className="rounded bg-amber-50 p-2 text-amber-900">本次流程核验失效。请返回岗位队列重新核验；若磁盘简历已变更，须登记新任务。不会自动换绑。</p>}
    {!clean&&<div role="status" className="text-amber-800">台账尚未获得保存确认；完成保存或到投递追踪处理草稿后再操作。{!ledger.dirty&&!ledger.saving&&!ledger.loading&&<button type="button" disabled={busy||logOpen} className={btn} onClick={()=>void run(async()=>{await careerLedger.load();if(mounted.current)setNotice('已读取磁盘台账，请重新核验。');})}>刷新岗位流程台账</button>}</div>}
    {error&&<p role="alert" className="break-words text-red-700">{error}</p>}
    {notice&&<p role="status" className="break-words text-teal-800">{notice}</p>}
    <div className="grid grid-cols-2 gap-1 rounded bg-slate-100 p-1">
      {(Object.keys(tabLabels) as Tab[]).map(t=><button type="button" key={t} aria-label={'岗位流程 '+tabLabels[t]} disabled={disabled} className={btn+(tab===t?' border-teal-500 bg-teal-50':'')} onClick={()=>switchTab(t)}>{tabLabels[t]}</button>)}
    </div>
    {!invalid&&tab==='review'&&<JobRequirementsPane document={document} slug={task.slug} jdText={task.jdText} onJdTextChange={()=>{}} onFlush={async()=>{await verify();}} queueReadBasis={verify} getRevision={()=>task.documentRevision} queueTask={task}/>}
    {!invalid&&tab==='letters'&&<div className="rounded border p-3 space-y-2">
      <h4 className="font-semibold">固定岗位自荐信（本地生成，可人工修改）</h4>
      <textarea aria-label="岗位自荐信正文" value={letter} rows={9} disabled={busy} onChange={e=>setLetter(e.target.value)} className="w-full rounded border p-2 text-slate-900"/>
      <input aria-label="岗位自荐信版本名" maxLength={200} value={letterTitle} onChange={e=>setLetterTitle(e.target.value)} disabled={busy} placeholder="选填版本名" className="w-full rounded border p-2"/>
      <div className="flex flex-wrap gap-2"><button type="button" className={primary} disabled={disabled} onClick={saveLetter}>保存岗位自荐信</button><button type="button" className={btn} disabled={disabled} onClick={exportLetter}>导出岗位自荐信 PDF</button></div>
      {letters.map(l=><div key={l.id} className="rounded border p-2"><p className="font-semibold break-words">{l.title}</p><p>{l.updatedAt}</p><button type="button" className={btn} disabled={disabled} onClick={()=>void run(async()=>{await verify();if(mounted.current){setLetter(l.bodyText);setLetterTitle(l.title);}})}>载入此岗位历史自荐信</button></div>)}
      <details><summary>本地邮件及平台话术参考（未发送）</summary><p className="font-semibold mt-2">{bundle.emailSubject}</p><pre className="whitespace-pre-wrap break-words">{bundle.emailBody}</pre><pre className="whitespace-pre-wrap break-words mt-2">{bundle.bossGreeting}</pre></details>
    </div>}
    {!invalid&&tab==='interview'&&<InterviewPracticePane document={document} slug={task.slug} queueTask={task} beforeQueueExport={verify}/>}
    {!invalid&&tab==='materials'&&<div className="rounded border p-3 space-y-2">
      <h4 className="font-semibold">原稿 PDF 与本地投递台账</h4>
      <p>先显式导出绑定的原稿 PDF，再确认永久归档。默认待投递；不自动发送或认定送达。ZIP 只包含已核验的原稿 PDF 及本人明确选择的附件。</p>
      <button type="button" className={primary} disabled={disabled} onClick={exportPdf}>导出岗位原稿 PDF</button>
      {snapshot&&<div className="rounded bg-teal-50 p-2 space-y-1"><p className="break-all">{snapshot.filePath}</p><p className="break-all text-[10px]">PDF SHA-256：{snapshot.pdfReceipt.sha256}</p><button type="button" className={btn} disabled={disabled} onClick={()=>void run(async()=>{await verify();if(mounted.current)setLogOpen(true);})}>核对并归档岗位 PDF</button></div>}
      {applications.map(a=><article key={a.id} className="rounded border p-2 space-y-1" aria-label={'岗位归档 '+a.id}><p className="font-semibold">{a.company} · {a.role}</p><p>{a.status==='wishlist'?'待投递': '本人台账状态：'+a.status} · 永久快照 {a.snapshotId}</p><p className="text-[10px] break-all">PDF SHA-256：{a.pdfReceipt?.sha256??'缺少凭证'}</p><button type="button" className={btn} disabled={disabled||!a.pdfReceipt||!a.snapshotId||!window.resumeDesktop?.applications?.exportPackage} onClick={()=>packagePdf(a)}>制作本岗位投递包 ZIP</button><p className="text-slate-600">完整只读复盘、状态管理与 PDF 核验仍在投递追踪。</p></article>)}
    </div>}
    {logOpen&&snapshot&&!invalid&&<QuickLogApplicationModal isOpen snapshot={snapshot} queueTask={task} queueRequestId={snapshot.requestId} beforeSubmit={verify} onClose={()=>setLogOpen(false)} onLogged={()=>{if(mounted.current){setSnapshot(null);setNotice('岗位 PDF 已封存至永久台账；未发送。');}}}/>}
  </section>;
}
