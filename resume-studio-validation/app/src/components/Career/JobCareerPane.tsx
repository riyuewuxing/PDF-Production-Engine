import {
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileDown,
  FileText,
  History,
  Loader2,
  Lock,
  Mail,
  MessageSquareText,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { apiClient, isDesktopMode, localErrorMessage } from '../../lib/apiClient';
import { careerLedger } from '../../lib/careerLedgerSession';
import { CareerAiPanel } from './CareerAiPanel';
import { InterviewPracticePane } from './InterviewPracticePane';
import { JobQueuePane } from './JobQueuePane';
import {VersionCompareModal,type ApplicationReviewSource} from '../Versions/VersionCompareModal';
import {visibleBasicValue} from '../../lib/aiContext';
import {
  COVER_LETTER_VARIANT_LABELS,
  buildApplicationsCsv,
  buildInterviewIcs,
  computeApplicationFunnel,
  resolveCoverLetterHeaderVariant,
} from '../../lib/careerExporter';
import {
  generateCoverLetterBundle,
} from '../../lib/jobToolkit';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_META,
  type ApplicationStatus,
  COVER_LETTER_HEADER_VARIANTS,
  type CoverLetterHeaderVariant,
  type JobApplication,
  type ApplicationPdfCheck,
  type SubmissionPackageResult,
  samePdfReceipt,
  type SavedCoverLetter,
} from '../../schema/applicationSchema';
import type { ResumeDocument, ResumeSummary } from '../../schema/resumeSchema';

type CareerSubTab = 'tracker' | 'letters' | 'interview' | 'queue';

interface JobCareerPaneProps {
  activeSlug: string;
  activeDoc: ResumeDocument;
  summaries: ResumeSummary[];
  masterSummary?:ResumeSummary|null;
  comparisonDisabled?:boolean;
  refreshKey?: number;
  onSwitchToResumeForEdit: (slug: string) => void;
  onCloneSnapshot?: (doc: ResumeDocument, suggestedTitle: string) => Promise<void> | void;
  onExportStatus?: (status: { type: 'ok' | 'error'; text: string; filePath?: string }) => void;
}

export function JobCareerPane({
  activeSlug,
  activeDoc,
  summaries,
  masterSummary=null,
  comparisonDisabled=false,
  refreshKey = 0,
  onSwitchToResumeForEdit,
  onCloneSnapshot,
  onExportStatus,
}: JobCareerPaneProps) {
  const [subTab, setSubTab] = useState<CareerSubTab>('tracker');
  const ledger=useSyncExternalStore(careerLedger.subscribe,careerLedger.getSnapshot);
  const storeData=ledger.data;
  const loading=ledger.loading||!ledger.ready;
  const saveTip=ledger.saving?'正在保存…':ledger.dirty?'存在未保存草稿':ledger.ready?'已读取本地台账':null;
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tracker draft form
  const [companyDraft, setCompanyDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState('');
  const [cityDraft, setCityDraft] = useState(visibleBasicValue(activeDoc,'location') || '');
  const [salaryDraft, setSalaryDraft] = useState('');
  const [slugDraft, setSlugDraft] = useState(activeSlug);
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all');
  const [expandedJdId, setExpandedJdId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [review,setReview]=useState<{activeSlug:string;activeDocId:string;source:ApplicationReviewSource}|null>(null);
  const [clonePhase,setClonePhase]=useState<'reading'|'writing'|null>(null);
  const [pdfCheck,setPdfCheck]=useState<{id:string;revision:string;action:'check'|'open'|'choose';result?:ApplicationPdfCheck;error?:string}|null>(null);
  const pdfTask=useRef<symbol|null>(null);
  const packageTask=useRef<symbol|null>(null);
  const [packageBusy,setPackageBusy]=useState(false);
  const [packageStatus,setPackageStatus]=useState<{id:string;revision:string;result?:SubmissionPackageResult;error?:string}|null>(null);
  const pdfEpoch=useRef(0);
  const pdfScope=useRef({revision:storeData.revision,comparisonDisabled,subTab,activeSlug});pdfScope.current={revision:storeData.revision,comparisonDisabled,subTab,activeSlug};
  const cloneRead=useRef<{controller:AbortController;cancel:()=>void;phase:'reading'|'writing'}|null>(null);
  const cloneScope=useRef({activeSlug,activeDocId:activeDoc.id,comparisonDisabled,subTab});cloneScope.current={activeSlug,activeDocId:activeDoc.id,comparisonDisabled,subTab};
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(cloneRead.current?.phase==='reading')cloneRead.current.cancel();};},[]);
  const ledgerReviewReady=ledger.ready&&!ledger.loading&&!ledger.saving&&!ledger.dirty&&!ledger.error&&typeof storeData.revision==='string'&&/^[a-f0-9]{64}$/.test(storeData.revision);
  const canReview=ledgerReviewReady&&!comparisonDisabled;
  const reviewValid=Boolean(review&&canReview&&subTab==='tracker'&&review.activeSlug===activeSlug&&review.activeDocId===activeDoc.id&&review.source.ledgerRevision===storeData.revision&&storeData.applications.filter(a=>a.id===review.source.id&&a.snapshotId===review.source.snapshotId).length===1);
  useEffect(()=>{if(!reviewValid)setReview(null);},[reviewValid]);
  useEffect(()=>{if(cloneRead.current?.phase==='reading')cloneRead.current.cancel();},[activeSlug,activeDoc.id,comparisonDisabled,subTab]);
  useEffect(()=>{pdfEpoch.current++;setPdfCheck(null);setPackageStatus(null);},[activeSlug,activeDoc.id,comparisonDisabled,subTab,storeData.revision,ledger.dirty,ledger.loading,ledger.saving,ledger.error]);

  // Cover letter & Interview state
  const [letterCompany, setLetterCompany] = useState('');
  const [letterRole, setLetterRole] = useState(visibleBasicValue(activeDoc,'title') || '');
  const [letterTitleDraft, setLetterTitleDraft] = useState('');
  const [headerVariantMode, setHeaderVariantMode] = useState<'auto' | CoverLetterHeaderVariant>('auto');
  const [jdOptional, setJdOptional] = useState('');
  const [coverLetterOverride, setCoverLetterOverride] = useState<string | null>(null);
  const [emailBodyOverride, setEmailBodyOverride] = useState<string | null>(null);
  const [bossOverride, setBossOverride] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [exportingLetter, setExportingLetter] = useState(false);

  useEffect(() => {
    setSlugDraft(activeSlug);
    if (!letterRole) setLetterRole(visibleBasicValue(activeDoc,'title') || '');
  }, [activeDoc.basic.title, activeSlug, letterRole]);

  useEffect(()=>{
    void careerLedger.load().catch(()=>{});
  },[refreshKey]);
  const backupLedger=async()=>{
    try{
      const result=await apiClient.saveTextFile({defaultFileName:'投递台账-未保存草稿-'+Date.now()+'.json',content:JSON.stringify(careerLedger.getSnapshot().data,null,2)+'\n',extension:'json',dialogTitle:'另存投递台账草稿',saveAs:true});
      if(!result.canceled)setErrorMsg('台账草稿已另存；原磁盘台账未覆盖。');
    }catch(err){setErrorMsg(localErrorMessage(err,'台账草稿备份失败'));}
  };
  const reloadLedger=async()=>{
    if(ledger.dirty&&!window.confirm('重新读取磁盘台账将放弃当前内存草稿。请先另存草稿。确定继续？'))return;
    try{await careerLedger.load(true);setErrorMsg(null);}
    catch(err){setErrorMsg(localErrorMessage(err,'重载失败，草稿仍保留。'));}
  };
  const handleAddApplication = () => {
    if (!companyDraft.trim()) return;
    if(!slugDraft||!(slugDraft==='master'&&activeSlug==='master')&&!summaries.some(s=>s.slug===slugDraft)){setErrorMsg('请选择当前有效的关联简历版本。');return;}
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const entry: JobApplication = {
      id: crypto.randomUUID(),
      company: companyDraft.trim(),
      role: roleDraft.trim() || visibleBasicValue(activeDoc,'title') || '目标岗位',
      city: cityDraft.trim(),
      salary: salaryDraft.trim(),
      resumeSlug: slugDraft || activeSlug,
      status: 'applied',
      appliedDate: today,
      notes: '',
      jdText: '',
      snapshotId: '',
      exportedFilePath: '',
      interviewAt: '',
      interviewLocation: '',
      atsScore: null,
      updatedAt: now,
    };
    if(careerLedger.update(current=>({...current,applications:[entry,...current.applications]}))){
      setCompanyDraft('');setRoleDraft('');setSalaryDraft('');
    }
  };

  const updateApplication=(id:string,patch:Partial<JobApplication>)=>{
    careerLedger.update(current=>({...current,applications:current.applications.map(item=>item.id===id?{...item,...patch,updatedAt:new Date().toISOString()}:item)}));
  };
  const deleteApplication=(item:JobApplication)=>{
    if(!window.confirm('移除投递台账记录「'+item.company+'」？已封存的永久快照会保留，不随台账删除。'))return;
    careerLedger.update(current=>({...current,applications:current.applications.filter(entry=>entry.id!==item.id)}));
  };

  const handlePdfCheck=async(item:JobApplication,action:'check'|'open'|'choose')=>{
    if(!canReview||!desktop||!item.snapshotId||!item.pdfReceipt||!storeData.revision||pdfTask.current||packageTask.current)return;
    const revision=storeData.revision,slug=activeSlug,token=Symbol('pdf-check'),epoch=pdfEpoch.current;
    pdfTask.current=token;
    setPdfCheck({id:item.id,revision,action});
    let timer:ReturnType<typeof setTimeout>|undefined;
    const alive=()=>mounted.current&&pdfTask.current===token&&pdfEpoch.current===epoch&&pdfScope.current.revision===revision&&!pdfScope.current.comparisonDisabled&&pdfScope.current.subTab==='tracker'&&pdfScope.current.activeSlug===slug&&!careerLedger.getSnapshot().dirty&&!careerLedger.getSnapshot().saving&&!careerLedger.getSnapshot().loading&&!careerLedger.getSnapshot().error;
    try{
      // Native file picker may remain open until the user chooses/cancels. No
      // fabricated cancellation of a system dialog; byte hashing has its own
      // main-process watchdog. Recorded-path checks have a UI wait deadline.
      const promise=apiClient.checkApplicationPdf({applicationId:item.id,snapshotId:item.snapshotId,ledgerRevision:revision},action);
      const result=action==='choose'?await promise:await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('等待 PDF 核验超过 12 秒；不显示迟到结果。系统打开操作若已派发不能撤回。')),12000);})]);
      if(alive())setPdfCheck({id:item.id,revision,action,result});
    }catch(err){if(alive())setPdfCheck({id:item.id,revision,action,error:localErrorMessage(err,'PDF 字节核验失败')});}
    finally{if(timer!==undefined)clearTimeout(timer);if(pdfTask.current===token)pdfTask.current=null;}
  };
  const handleSubmissionPackage=async(item:JobApplication)=>{
    if(!canReview||!desktop||!item.snapshotId||!item.pdfReceipt||!storeData.revision||packageTask.current||pdfTask.current)return;
    const revision=storeData.revision,token=Symbol('submission-package'),epoch=pdfEpoch.current;
    packageTask.current=token;setPackageBusy(true);setPackageStatus({id:item.id,revision});
    const alive=()=>mounted.current&&packageTask.current===token&&pdfEpoch.current===epoch&&pdfScope.current.revision===revision&&!pdfScope.current.comparisonDisabled&&pdfScope.current.subTab==='tracker'&&!careerLedger.getSnapshot().dirty&&!careerLedger.getSnapshot().saving&&!careerLedger.getSnapshot().loading&&!careerLedger.getSnapshot().error;
    try{
      const result=await apiClient.exportApplicationPackage({applicationId:item.id,snapshotId:item.snapshotId,ledgerRevision:revision});
      if(alive())setPackageStatus({id:item.id,revision,result});
    }catch(err){if(alive())setPackageStatus({id:item.id,revision,error:localErrorMessage(err,'制作投递包失败')});}
    finally{if(packageTask.current===token)packageTask.current=null;if(mounted.current)setPackageBusy(false);}
  };
  const openApplicationReview=(item:JobApplication)=>{
    if(!canReview||!item.snapshotId||!storeData.revision)return;
    setReview({activeSlug,activeDocId:activeDoc.id,source:{id:item.id,snapshotId:item.snapshotId,resumeSlug:item.resumeSlug,company:item.company,role:item.role,exportedFilePath:item.exportedFilePath,atsScore:item.atsScore,pdfReceipt:item.pdfReceipt,ledgerRevision:storeData.revision}});
  };
  const handleCloneSnapshotToWorkspace = async (item: JobApplication) => {
    if (!item.snapshotId || !onCloneSnapshot||!canReview||!storeData.revision||cloneRead.current) return;
    const revision=storeData.revision,slug=activeSlug,docId=activeDoc.id;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    let rejectPending:((err:Error)=>void)|undefined;
    const cancel=()=>{controller.abort();rejectPending?.(new Error('已取消读取永久快照。'));};
    const token:{controller:AbortController;cancel:()=>void;phase:'reading'|'writing'}={controller,cancel,phase:'reading'};cloneRead.current=token;
    setCloningId(item.id);setClonePhase('reading');
    setErrorMsg(null);
    try {
      const record=await Promise.race([
        apiClient.getLinkedApplicationSnapshot({applicationId:item.id,snapshotId:item.snapshotId,ledgerRevision:revision},controller.signal),
        new Promise<never>((_,reject)=>{rejectPending=reject;timer=setTimeout(()=>{controller.abort();reject(new Error('读取永久快照超过 10 秒，已停止等待，未克隆。'));},10_000);})
      ]);
      if(timer!==undefined)clearTimeout(timer);
      if(!mounted.current||controller.signal.aborted)return;
      const current=careerLedger.getSnapshot();
      if(cloneScope.current.activeSlug!==slug||cloneScope.current.activeDocId!==docId||cloneScope.current.subTab!=='tracker'||cloneScope.current.comparisonDisabled||current.dirty||current.saving||current.loading||current.error||current.data.revision!==revision)throw new Error('当前版本或台账状态已变化，未克隆永久快照。');
      if(record.meta.id!==item.snapshotId.replace(/\.json$/i,'')||record.meta.applicationId!==item.id||record.meta.resumeSlug!==item.resumeSlug||record.meta.exportedFilePath!==item.exportedFilePath||record.meta.atsScore!==item.atsScore||!samePdfReceipt(record.meta.pdfReceipt,item.pdfReceipt)||record.meta.title!==record.document.title||record.meta.templateId!==record.document.templateId||!Number.isFinite(Date.parse(record.meta.createdAt)))throw new Error('永久快照关联身份校验失败，未克隆。');
      const cleanName = item.company+'-'+(item.role||record.document.title)+'-复盘版';
      // The explicit clone command is a separate, normal version-create operation.
      // The 10-second deadline applies only to the read, never claims to cancel a write already started.
      token.phase='writing';setClonePhase('writing');
      await onCloneSnapshot(record.document, cleanName);
    } catch (err) {
      if(mounted.current)setErrorMsg(localErrorMessage(err,'读取永久快照失败'));
    } finally {
      if(timer!==undefined)clearTimeout(timer);
      if(cloneRead.current===token)cloneRead.current=null;
      if(mounted.current){setCloningId(null);setClonePhase(null);}
    }
  };

  const handleExportCsv = async () => {
    setErrorMsg(null);
    try {
      const csv = buildApplicationsCsv(visibleApplications);
      const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const res = await apiClient.saveTextFile({
        defaultFileName: `求职投递台账-${stamp}.csv`,
        content: csv,
        extension: 'csv',
        filterName: 'CSV 表格文件',
        dialogTitle: '导出求职投递台账 CSV',
        mimeType: 'text/csv;charset=utf-8',
      });
      if (!res.canceled && res.filePath) {
        onExportStatus?.({
          type: 'ok',
          text: `已导出投递台账 CSV：${res.filePath}`,
          filePath: res.filePath,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导出 CSV 失败');
    }
  };

  const handleExportIcs = async (item: JobApplication) => {
    setErrorMsg(null);
    try {
      const ics = buildInterviewIcs(item);
      const res = await apiClient.saveTextFile({
        defaultFileName: `面试-${item.company || '单位'}-${item.role || '岗位'}.ics`,
        content: ics,
        extension: 'ics',
        filterName: 'iCalendar 日程文件',
        dialogTitle: '导出面试提醒 .ics',
        mimeType: 'text/calendar;charset=utf-8',
      });
      if (!res.canceled && res.filePath) {
        onExportStatus?.({
          type: 'ok',
          text: `已导出面试日程 (.ics)：${res.filePath}`,
          filePath: res.filePath,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导出面试 .ics 失败');
    }
  };

  const letterBundle = useMemo(
    () =>
      generateCoverLetterBundle(activeDoc, {
        company: letterCompany,
        role: letterRole || visibleBasicValue(activeDoc,'title'),
      }),
    [activeDoc, letterCompany, letterRole],
  );

  const effectiveCoverLetter = coverLetterOverride ?? letterBundle.coverLetterText;
  const effectiveEmailBody = emailBodyOverride ?? letterBundle.emailBody;
  const effectiveBossText = bossOverride ?? letterBundle.bossGreeting;
  const resolvedHeaderVariant: CoverLetterHeaderVariant =
    headerVariantMode === 'auto'
      ? resolveCoverLetterHeaderVariant(activeDoc.templateId)
      : headerVariantMode;

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 1800);
    } catch {
      setErrorMsg('复制到剪贴板失败，请手动选中复制');
    }
  };

  const handleExportCoverLetter = async () => {
    setExportingLetter(true);
    setErrorMsg(null);
    try {
      const contactLine = [
        visibleBasicValue(activeDoc,'name') || '',
        visibleBasicValue(activeDoc,'phone') ? `电话：${activeDoc.basic.phone}` : '',
        visibleBasicValue(activeDoc,'email') ? `邮箱：${activeDoc.basic.email}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      const res = await apiClient.exportCoverLetterPdf({
        payload: {
          title: '求职自荐信',
          company: letterCompany.trim() || '贵单位',
          role: letterRole.trim() || visibleBasicValue(activeDoc,'title') || '目标岗位',
          candidateName: visibleBasicValue(activeDoc,'name') || '求职者',
          candidateTitle: visibleBasicValue(activeDoc,'title') || '',
          contactLine,
          bodyText: effectiveCoverLetter,
          themeColor: activeDoc.globalSettings.themeColor || '#167883',
          fontFamily: activeDoc.globalSettings.fontFamily,
          customFontFamily: activeDoc.globalSettings.customFontFamily,
          headerVariant: resolvedHeaderVariant,
          dateText: new Date().toISOString().slice(0, 10),
        },
      });
      if (!res.canceled && res.filePath) {
        onExportStatus?.({
          type: 'ok',
          text: `已导出自荐信矢量 PDF：${res.filePath}`,
          filePath: res.filePath,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导出自荐信 PDF 失败');
    } finally {
      setExportingLetter(false);
    }
  };

  const handleSaveCoverLetterVersion = () => {
    const company = letterCompany.trim();
    const role = letterRole.trim() || visibleBasicValue(activeDoc,'title') || '目标岗位';
    const title =
      letterTitleDraft.trim() || `${company || '通用'}-${role}-${new Date().toISOString().slice(0, 10)}`;
    const entry: SavedCoverLetter = {
      id: crypto.randomUUID(),
      title,
      company,
      role,
      bodyText: effectiveCoverLetter,
      headerVariant: resolvedHeaderVariant,
      resumeSlug: activeSlug,
      updatedAt: new Date().toISOString(),
    };
    if(careerLedger.update(current=>({...current,coverLetters:[entry,...current.coverLetters]})))setLetterTitleDraft('');
  };

  const handleLoadCoverLetterVersion = (saved: SavedCoverLetter) => {
    setLetterCompany(saved.company);
    setLetterRole(saved.role);
    setCoverLetterOverride(saved.bodyText);
    setHeaderVariantMode(saved.headerVariant);
  };

  const handleDeleteCoverLetterVersion = (id: string) => {
    careerLedger.update(current=>({...current,coverLetters:current.coverLetters.filter(item=>item.id!==id)}));
  };

  const visibleApplications=useMemo(()=>comparisonDisabled?storeData.applications.filter(a=>!a.queueTaskId):storeData.applications,[storeData.applications,comparisonDisabled]);
  const funnel = useMemo(
    () => computeApplicationFunnel(visibleApplications),
    [visibleApplications],
  );
  const activeFollowups = funnel.wishlist + funnel.applied + funnel.written + funnel.interview;
  const filteredApps =
    statusFilter === 'all'
      ? visibleApplications
      : visibleApplications.filter((a) => a.status === statusFilter);
  const desktop = isDesktopMode();

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <BriefcaseBusiness size={14} className="text-teal-700" />
            <span>求职与面试全周期工作台</span>
          </div>
          {saveTip && <span className={'text-[10px] '+(ledger.dirty?'text-amber-700':'text-emerald-600')}>{saveTip}</span>}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-0.5 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setSubTab('tracker')}
            className={`rounded py-1 transition ${
              subTab === 'tracker' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            投递追踪 ({funnel.total})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('letters')}
            className={`rounded py-1 transition ${
              subTab === 'letters' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            自荐信 / 话术
          </button>
          <button
            type="button"
            onClick={() => setSubTab('interview')}
            className={`rounded py-1 transition ${
              subTab === 'interview' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            面试追问
          </button>
          <button type="button" aria-label="岗位队列" onClick={()=>setSubTab('queue')} className={`rounded py-1 transition ${subTab==='queue'?'bg-white text-slate-900 shadow-xs':'text-slate-600 hover:text-slate-900'}`}>
            岗位队列 ({storeData.jobQueue?.length??0})
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {errorMsg && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {errorMsg}
          </div>
        )}

        {(ledger.error||ledger.dirty)&&<div role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900 space-y-2">
          <div className="font-semibold">{ledger.error||'台账草稿等待保存'}</div>
          <div className="flex flex-wrap gap-2">
            {ledger.dirty&&<><button type="button" disabled={ledger.saving} onClick={()=>void careerLedger.flush().catch(()=>{})} className="rounded border px-2 py-1">重试保存台账</button><button type="button" onClick={()=>void backupLedger()} className="rounded border px-2 py-1">另存台账草稿</button></>}
            <button type="button" disabled={ledger.saving||ledger.loading} onClick={()=>void reloadLedger()} className="rounded border px-2 py-1">重载磁盘台账</button>
          </div>
        </div>}
        {comparisonDisabled&&<p className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">脱敏预览开启时隐藏队列关联投递，禁止复盘、克隆原始永久快照或打开关联 PDF。</p>}
        {!loading&&!ledgerReviewReady&&<p className="text-[11px] text-slate-600">永久快照复盘及克隆需要已确认的磁盘台账，请先处理未保存草稿或重新加载。</p>}
        {!loading&&!ledger.dirty&&!ledger.error&&subTab==='tracker'&&<div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5"><span className="text-[10px] text-slate-600">复盘基于已确认磁盘台账；外部变动后请刷新。</span><button type="button" disabled={ledger.saving||ledger.loading||Boolean(cloningId)} onClick={()=>void reloadLedger()} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 disabled:opacity-40">刷新磁盘台账</button></div>}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 size={16} className="mr-2 animate-spin" /> {ledger.error&&!ledger.loading?'台账尚未成功读取，请先重载。':'正在加载本地求职数据…'}
          </div>
        ) : (
          <>
            {subTab === 'tracker' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center">
                    <div className="text-[10px] text-slate-500">累计投递</div>
                    <div className="mt-0.5 text-base font-bold text-slate-900">{funnel.total}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center">
                    <div className="text-[10px] text-slate-500">推进转化率</div>
                    <div className="mt-0.5 text-base font-bold text-teal-700">{funnel.progressedRate}%</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center">
                    <div className="text-[10px] text-slate-500">待跟进流程</div>
                    <div className="mt-0.5 text-base font-bold text-amber-700">{activeFollowups}</div>
                  </div>
                </div>

                {/* 5-Stage Conversion Funnel + Export CSV */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700">
                      5 阶段漏斗（面邀 {funnel.interviewRate}% · Offer {funnel.offerRate}%）
                    </span>
                    <button
                      type="button"
                      disabled={visibleApplications.length === 0}
                      onClick={() => void handleExportCsv()}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <Download size={10} /> 导出 CSV
                    </button>
                  </div>
                  <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
                    {(
                      [
                        ['wishlist', '待投'],
                        ['applied', '已投'],
                        ['written', '笔试'],
                        ['interview', '面试'],
                        ['offer', 'Offer'],
                      ] as const
                    ).map(([st, shortLabel]) => (
                      <div key={st} className="rounded border border-slate-200 bg-white py-1">
                        <div className="text-slate-500">{shortLabel}</div>
                        <div className="font-bold text-slate-900">{funnel[st]}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add Application Card */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <div className="font-semibold text-slate-800">新增投递记录</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      data-native-undo="true"
                      value={companyDraft}
                      onChange={(e) => setCompanyDraft(e.target.value)}
                      placeholder="单位/学校名称（必填）"
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-900"
                    />
                    <input
                      type="text"
                      data-native-undo="true"
                      value={roleDraft}
                      onChange={(e) => setRoleDraft(e.target.value)}
                      placeholder="投递岗位名称"
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-900"
                    />
                    <input
                      type="text"
                      data-native-undo="true"
                      value={cityDraft}
                      onChange={(e) => setCityDraft(e.target.value)}
                      placeholder="城市（如：示例城市）"
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-900"
                    />
                    <input
                      type="text"
                      data-native-undo="true"
                      value={salaryDraft}
                      onChange={(e) => setSalaryDraft(e.target.value)}
                      placeholder="薪资/编制情况"
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="关联本地简历版本"
                      value={slugDraft}
                      onChange={(e) => setSlugDraft(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-900"
                    >
                      {activeSlug==='master'&&<option value="master">关联母库：{activeDoc.title}</option>}
                      {summaries.map((s) => (
                        <option key={s.slug} value={s.slug}>
                          关联版本：{s.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddApplication}
                      className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800"
                    >
                      <Plus size={13} /> 记一笔
                    </button>
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      statusFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    全部 ({funnel.total})
                  </button>
                  {APPLICATION_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        statusFilter === st
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {APPLICATION_STATUS_META[st].label}
                    </button>
                  ))}
                </div>

                {/* Tracker List */}
                <div className="space-y-2.5">
                  {filteredApps.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-[11px] text-slate-400">
                      暂无投递记录。导出 PDF 后可一键“记入投递并锁定快照”，也可在上方手动记一笔。
                    </div>
                  ) : (
                    filteredApps.map((item) => {
                      const linked = summaries.find((s) => s.slug === item.resumeSlug);
                      const isJdExpanded = expandedJdId === item.id;
                      return (
                        <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 font-bold text-slate-900">
                                <span>
                                  {item.company} · {item.role}{item.queueTaskId&&<span className="ml-1 rounded bg-teal-50 px-1 text-[10px] text-teal-800">固定岗位</span>}
                                </span>
                                {item.snapshotId && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                    <Lock size={9} /> 已关联永久快照
                                  </span>
                                )}
                                {item.atsScore !== null && item.atsScore !== undefined && (
                                  <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                                    ATS {item.atsScore}分
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                                {item.city && <span>{item.city}</span>}
                                {item.salary && <span>{item.salary}</span>}
                                {item.appliedDate && <span>{item.appliedDate}</span>}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void deleteApplication(item)}
                              aria-label={`删除投递 ${item.company}`}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <select
                              aria-label={`${item.company} 状态`}
                              value={item.status}
                              onChange={(e) =>
                                updateApplication(item.id, { status: e.target.value as ApplicationStatus })
                              }
                              className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                                APPLICATION_STATUS_META[item.status].badgeClass
                              }`}
                            >
                              {APPLICATION_STATUSES.map((st) => (
                                <option key={st} value={st}>
                                  {APPLICATION_STATUS_META[st].label}
                                </option>
                              ))}
                            </select>

                            <div className="flex flex-wrap items-center gap-1">
                              {item.snapshotId&&<button type="button" disabled={!canReview||Boolean(cloningId)} onClick={()=>openApplicationReview(item)} aria-label={'只读复盘 '+item.company} className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 disabled:opacity-40"><History size={10}/> 只读复盘</button>}
                              {item.snapshotId && onCloneSnapshot && (
                                <button
                                  type="button"
                                  disabled={!canReview||Boolean(cloningId)}
                                  onClick={() => void handleCloneSnapshotToWorkspace(item)}
                                  className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                                >
                                  <History size={10} />
                                  {cloningId===item.id?(clonePhase==='reading'?'读取核验中…':'创建复盘版…'):'克隆回工作台'}
                                </button>
                              )}
                              {cloningId===item.id&&clonePhase==='reading'&&<button type="button" onClick={()=>{if(cloneRead.current?.phase==='reading')cloneRead.current.cancel();}} className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">取消读取快照</button>}
                              {item.pdfReceipt&&item.snapshotId&&item.exportedFilePath&&desktop&&<>
                                <button type="button" disabled={!canReview||packageBusy||Boolean(pdfCheck&&!pdfCheck.result&&!pdfCheck.error)} onClick={()=>void handlePdfCheck(item,'check')} aria-label={'核验 PDF '+item.company} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 disabled:opacity-40">核验 PDF</button>
                                <button type="button" disabled={!canReview||packageBusy||Boolean(pdfCheck&&!pdfCheck.result&&!pdfCheck.error)} onClick={()=>void handlePdfCheck(item,'open')} aria-label={'核验并打开 PDF '+item.company} title="每次打开前重新核验记录路径的实际字节；核验不是对随后文件变化的锁定" className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] text-teal-800 disabled:opacity-40">核验并打开</button>
                                <button type="button" disabled={!canReview||packageBusy||Boolean(pdfCheck&&!pdfCheck.result&&!pdfCheck.error)} onClick={()=>void handlePdfCheck(item,'choose')} aria-label={'选择 PDF 核验 '+item.company} title="显式选择已移动或另存的文件，仅比较字节，不改台账路径" className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 disabled:opacity-40">选择文件核验</button>
                                <button type="button" disabled={!canReview||packageBusy||Boolean(pdfCheck&&!pdfCheck.result&&!pdfCheck.error)||!window.resumeDesktop?.applications?.exportPackage} onClick={()=>void handleSubmissionPackage(item)} aria-label={'制作投递包 '+item.company} className="rounded border border-indigo-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-800 disabled:opacity-40">制作投递包 ZIP</button>
                              </>}
                              {item.exportedFilePath && !item.pdfReceipt && desktop && (
                                <button
                                  type="button"
                                  disabled={comparisonDisabled}
                                  title="台账记录的路径，未核验文件内容与封存时一致；打开前请自行核对。"
                                  onClick={() => void apiClient.openFile(item.exportedFilePath)}
                                  className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
                                >
                                  <FileText size={10} /> 关联 PDF
                                </button>
                              )}
                              {item.resumeSlug && (
                                <button
                                  type="button"
                                  onClick={() => onSwitchToResumeForEdit(item.resumeSlug)}
                                  className="inline-flex items-center gap-0.5 rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-100"
                                >
                                  编辑关联：{linked?.title || item.resumeSlug}
                                  <ArrowUpRight size={11} />
                                </button>
                              )}
                            </div>
                          </div>

                          {!comparisonDisabled&&packageStatus?.id===item.id&&packageStatus.revision===storeData.revision&&<div role={packageStatus.error?'alert':'status'} className="rounded border border-indigo-200 bg-indigo-50 p-2 text-[11px] text-indigo-900 space-y-1">
                            {packageStatus.error??(!packageStatus.result?'正在制作投递包，请在系统窗口选择、确认或取消。':packageStatus.result.canceled?'已取消制作投递包。':'本地投递包 ZIP 已生成（未发送）')}
                            {packageStatus.result&&!packageStatus.result.canceled&&<>
                              <div className="break-all">{packageStatus.result.filePath}</div>
                              <div className="break-all font-mono">SHA256 {packageStatus.result.sha256}</div>
                              {packageStatus.result.entries.map(entry=><div key={entry.name}>{entry.name} · {entry.sizeBytes.toLocaleString()} 字节</div>)}
                              <div>请在发送前自行核对压缩包中全部文件；未修改投递台账。</div>
                            </>}
                          </div>}
                          {item.exportedFilePath&&<div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                            {item.pdfReceipt?<><div className="font-semibold text-indigo-800">已封存导出字节凭证 · 尚需按需核验</div>
                              <div className="break-all font-mono text-[10px]" title={item.pdfReceipt.sha256}>SHA256 {item.pdfReceipt.sha256.slice(0,16)}… · {item.pdfReceipt.sizeBytes.toLocaleString()} 字节</div>
                              {!desktop&&<div>文件字节核验仅支持桌面工作台。</div>}
                              {!comparisonDisabled&&pdfCheck?.id===item.id&&pdfCheck.revision===storeData.revision&&<div role={pdfCheck.error?'alert':'status'} className="mt-1 rounded bg-white p-1.5">
                                {pdfCheck.error??(!pdfCheck.result?'正在核验…':{
                                  verified:pdfCheck.action==='choose'?'所选文件字节一致（未修改台账路径）':pdfCheck.result.opened?'记录路径字节一致，已请求系统打开':'记录路径字节一致',
                                  changed:'文件字节与封存凭证不一致，未打开',
                                  missing:'记录文件缺失，未打开',
                                  unsafe:'路径或文件类型不安全，未读取或打开',
                                  unavailable:'无法核验（可能是外部路径、权限、大小上限或取消选择）；可显式选择文件',
                                  unknown:'没有可核验的历史字节凭证'
                                }[pdfCheck.result.status])}
                                {pdfCheck.result&&<div className="text-[10px] text-slate-500">核验时间 {new Date(pdfCheck.result.checkedAt).toLocaleString('zh-CN',{hour12:false})}；仅本次观察，不证明发送或送达。</div>}
                              </div>}
                            </>:<span>历史 PDF 路径 · 无字节凭证（内容未验证）</span>}
                          </div>}
                          {/* Interview schedule + .ics */}
                          <div className="grid grid-cols-5 items-center gap-1.5">
                            <input
                              type="text"
                              data-native-undo="true"
                              value={item.interviewAt}
                              onChange={(e) => updateApplication(item.id, { interviewAt: e.target.value })}
                              placeholder="面试时间 (如 2026-11-25 14:30)"
                              aria-label={`${item.company} 面试时间`}
                              className="col-span-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-800"
                            />
                            <input
                              type="text"
                              data-native-undo="true"
                              value={item.interviewLocation}
                              onChange={(e) =>
                                updateApplication(item.id, { interviewLocation: e.target.value })
                              }
                              placeholder="面试地点/会议链接"
                              aria-label={`${item.company} 面试地点`}
                              className="col-span-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-800"
                            />
                            <button
                              type="button"
                              onClick={() => void handleExportIcs(item)}
                              title="导出 RFC 5545 标准日历日程（含提前 30 分钟提醒）"
                              className="inline-flex items-center justify-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] font-medium text-amber-800 hover:bg-amber-100"
                            >
                              <CalendarPlus size={11} /> .ics
                            </button>
                          </div>

                          {!ledger.dirty&&(storeData.jobReviews??[]).some(a=>a.applicationId===item.id&&a.snapshotId===item.snapshotId)&&(
                            <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-[11px] text-indigo-900">
                              已关联 {(storeData.jobReviews??[]).filter(a=>a.applicationId===item.id&&a.snapshotId===item.snapshotId).length} 份历史岗位人工核对档案（非当前资格结论）。在 JD 雷达中按原版本恢复并重新校验。
                            </div>
                          )}
                          {item.jdText && (
                            <div className="rounded border border-slate-200 bg-slate-50/70">
                              <button
                                type="button"
                                onClick={() => setExpandedJdId(isJdExpanded ? null : item.id)}
                                className="flex w-full items-center justify-between px-2 py-1 text-[10px] font-medium text-slate-600 hover:text-slate-900"
                              >
                                <span>已封存岗位 JD（{item.jdText.length} 字）</span>
                                <ChevronDown
                                  size={12}
                                  className={`transition-transform ${isJdExpanded ? 'rotate-180' : ''}`}
                                />
                              </button>
                              {isJdExpanded && (
                                <pre className="max-h-36 overflow-auto whitespace-pre-wrap border-t border-slate-200 p-2 font-sans text-[10px] leading-relaxed text-slate-700">
                                  {item.jdText}
                                </pre>
                              )}
                            </div>
                          )}

                          <textarea
                            rows={2}
                            data-native-undo="true"
                            value={item.notes}
                            onChange={(e) => updateApplication(item.id, { notes: e.target.value })}
                            placeholder="记录笔试真题、试讲课题或面试复盘..."
                            className="w-full rounded border border-slate-200 bg-slate-50 p-1.5 text-[11px] text-slate-800 focus:bg-white focus:outline-none"
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {subTab === 'letters' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <div className="font-semibold text-slate-800">设定目标单位、岗位与页眉风格</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      data-native-undo="true"
                      value={letterCompany}
                      onChange={(e) => {
                        setLetterCompany(e.target.value);
                        setCoverLetterOverride(null);
                        setEmailBodyOverride(null);
                        setBossOverride(null);
                      }}
                      placeholder="目标单位（如：示例一中）"
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-900"
                    />
                    <input
                      type="text"
                      data-native-undo="true"
                      value={letterRole}
                      onChange={(e) => {
                        setLetterRole(e.target.value);
                        setCoverLetterOverride(null);
                        setEmailBodyOverride(null);
                        setBossOverride(null);
                      }}
                      placeholder="目标岗位（如：高中物理教师）"
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-900"
                    />
                  </div>
                  <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                    <span className="shrink-0">PDF 页眉风格</span>
                    <select
                      aria-label="自荐信页眉风格"
                      value={headerVariantMode}
                      onChange={(e) =>
                        setHeaderVariantMode(e.target.value as 'auto' | CoverLetterHeaderVariant)
                      }
                      className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-slate-900"
                    >
                      <option value="auto">
                        自动匹配当前简历（
                        {COVER_LETTER_VARIANT_LABELS[resolveCoverLetterHeaderVariant(activeDoc.templateId)]}）
                      </option>
                      {COVER_LETTER_HEADER_VARIANTS.map((v) => (
                        <option key={v} value={v}>
                          {COVER_LETTER_VARIANT_LABELS[v]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <textarea
                    rows={2}
                    data-native-undo="true"
                    value={jdOptional}
                    onChange={(e) => setJdOptional(e.target.value)}
                    placeholder="（可选）粘贴招聘 JD 关键词，搭配已配置的 BYOK 大模型深度定制"
                    className="w-full rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-800"
                  />
                </div>

                <CareerAiPanel document={activeDoc} slug={activeSlug} company={letterCompany} role={letterRole||visibleBasicValue(activeDoc,'title')} jdText={jdOptional}
                  drafts={{coverLetter:effectiveCoverLetter,email:effectiveEmailBody,boss:effectiveBossText}}
                  onApply={(kind,text)=>{if(kind==='coverLetter')setCoverLetterOverride(text);else if(kind==='email')setEmailBodyOverride(text);else setBossOverride(text);}}/>
                {/* 1. Formal Cover Letter + Version Save */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">1. 正式自荐信 / 求职信</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void copyText('cover', effectiveCoverLetter)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
                      >
                        {copiedKey === 'cover' ? <Check size={11} /> : <Copy size={11} />}
                        {copiedKey === 'cover' ? '已复制' : '复制'}
                      </button>
                      <button
                        type="button"
                        disabled={exportingLetter}
                        onClick={() => void handleExportCoverLetter()}
                        className="inline-flex items-center gap-1 rounded bg-teal-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-teal-500 disabled:opacity-50"
                      >
                        <FileDown size={11} /> {exportingLetter ? '导出中...' : '导出自荐信 PDF'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={8}
                    data-native-undo="true"
                    value={effectiveCoverLetter}
                    onChange={(e) => setCoverLetterOverride(e.target.value)}
                    className="w-full rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-900"
                  />

                  {/* Save to coverLetters library */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      data-native-undo="true"
                      value={letterTitleDraft}
                      onChange={(e) => setLetterTitleDraft(e.target.value)}
                      placeholder="版本标题（留空则按单位-岗位-日期自动命名）"
                      className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={handleSaveCoverLetterVersion}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                    >
                      <Save size={11} /> 存为模板版本
                    </button>
                  </div>

                  {(storeData.coverLetters ?? []).some(l=>!l.queueTaskId) && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-2">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                        <Bookmark size={11} className="text-teal-600" />
                        已存自荐信版本库 ({storeData.coverLetters.filter(l=>!l.queueTaskId).length})
                      </div>
                      <div className="space-y-1">
                        {storeData.coverLetters.filter(l=>!l.queueTaskId).map((saved) => (
                          <div
                            key={saved.id}
                            className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]"
                          >
                            <button
                              type="button"
                              onClick={() => handleLoadCoverLetterVersion(saved)}
                              className="min-w-0 flex-1 truncate text-left font-medium text-slate-800 hover:text-teal-700"
                              title="点击载入编辑器"
                            >
                              {saved.title}（{saved.headerVariant}）
                            </button>
                            <button
                              type="button"
                              aria-label={`删除自荐信版本 ${saved.title}`}
                              onClick={() => handleDeleteCoverLetterVersion(saved.id)}
                              className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Email Subject + Body */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                      <Mail size={13} className="text-sky-600" /> 2. 规范投递邮件主题与正文
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(
                          'email',
                          `主题：${letterBundle.emailSubject}\n\n${effectiveEmailBody}`,
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
                    >
                      {copiedKey === 'email' ? <Check size={11} /> : <Copy size={11} />}
                      {copiedKey === 'email' ? '已复制' : '复制全套邮件'}
                    </button>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-100 px-2.5 py-1.5 font-mono text-[11px] text-slate-800">
                    主题：{letterBundle.emailSubject}
                  </div>
                  <textarea
                    rows={5}
                    data-native-undo="true"
                    value={effectiveEmailBody}
                    onChange={(e) => setEmailBodyOverride(e.target.value)}
                    className="w-full rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-900"
                  />
                </div>

                {/* 3. BOSS / Platform 3-sentence Opener */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                      <MessageSquareText size={13} className="text-emerald-600" /> 3. BOSS直聘 / 招聘平台 3 句话开场白
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyText('boss', effectiveBossText)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
                    >
                      {copiedKey === 'boss' ? <Check size={11} /> : <Copy size={11} />}
                      {copiedKey === 'boss' ? '已复制' : '复制话术'}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    data-native-undo="true"
                    value={effectiveBossText}
                    onChange={(e) => setBossOverride(e.target.value)}
                    className="w-full rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-900"
                  />
                </div>
              </div>
            )}

            {subTab==='queue'&&<JobQueuePane key={JSON.stringify([activeSlug,activeDoc.id])} activeSlug={activeSlug} activeDoc={activeDoc} redacted={comparisonDisabled}/>}
            {subTab === 'interview' && (
              <InterviewPracticePane key={JSON.stringify([activeSlug,activeDoc.id])} document={activeDoc} slug={activeSlug}/>
            )}
          </>
        )}
      </div>
      {reviewValid&&review&&<VersionCompareModal key={review.source.id+':'+review.source.ledgerRevision+':'+activeSlug} activeSlug={activeSlug} activeDoc={activeDoc} summaries={summaries} masterSummary={masterSummary} snapshots={[]} applicationReview={review.source} onClose={()=>setReview(null)}/>}
    </div>
  );
}
