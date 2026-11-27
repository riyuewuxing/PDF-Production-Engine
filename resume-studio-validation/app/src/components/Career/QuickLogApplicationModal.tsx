import { BookmarkCheck, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { localErrorMessage } from '../../lib/apiClient';
import { careerLedger } from '../../lib/careerLedgerSession';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_META,
  type ApplicationStatus,
  type JobApplication,
  type PdfArtifactReceipt,
  type JobQueueTask,
} from '../../schema/applicationSchema';
import type { ResumeDocument } from '../../schema/resumeSchema';

export interface FrozenPdfExportSnapshot {
  slug: string;
  filePath: string;
  document: ResumeDocument;
  isRedacted: boolean;
  pdfReceipt:PdfArtifactReceipt;
  pdfReceiptToken:string;
}

interface QuickLogApplicationModalProps {
  isOpen: boolean;
  snapshot: FrozenPdfExportSnapshot | null;
  defaultJdText?: string;
  defaultAtsScore?: number | null;
  queueTask?:JobQueueTask;
  beforeSubmit?:()=>Promise<unknown>;
  queueRequestId?:string;
  onClose: () => void;
  onLogged: (entry: JobApplication) => void;
}

export function QuickLogApplicationModal({
  isOpen,
  snapshot,
  defaultJdText = '',
  defaultAtsScore = null,
  queueTask,beforeSubmit,queueRequestId,
  onClose,
  onLogged,
}: QuickLogApplicationModalProps) {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [city, setCity] = useState('');
  const [salary, setSalary] = useState('');
  const [status, setStatus] = useState<ApplicationStatus>('applied');
  const [jdText, setJdText] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const requestId=useRef<string|null>(null);
  const submitting=useRef(false);
  const refreshingRef=useRef(false);
  const [refreshing,setRefreshing]=useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !snapshot) return;
    requestId.current=queueTask?queueRequestId??null:null;
    setCompany(queueTask?.company??'');
    setRole(queueTask?.role??snapshot.document.basic.title??'');
    setCity(snapshot.document.basic.location || '');
    setSalary('');
    setStatus(queueTask?'wishlist':'applied');
    setJdText(queueTask?.jdText??defaultJdText);
    setNotes('');
    setErrorMsg(null);
  }, [defaultJdText, isOpen, snapshot,queueTask,queueRequestId]);

  const refreshQueueLedger=async()=>{
    if(!queueTask||submitting.current||refreshingRef.current)return;
    refreshingRef.current=true;setRefreshing(true);
    let watchdog:ReturnType<typeof setTimeout>|undefined;
    try{
      watchdog=setTimeout(()=>setErrorMsg('读取台账超过10秒，仍未确认；请勿重复提交。'),10000);
      await careerLedger.load();
      const now=careerLedger.getSnapshot();
      if(!now.ready||now.loading||now.saving||now.dirty||now.error||!now.data.revision)throw Error('台账读取尚未确认，未继续归档。');
      setErrorMsg('已刷新磁盘台账，请核验后重试同一请求。');
    }catch(e){setErrorMsg(localErrorMessage(e,'刷新失败'));}
    finally{if(watchdog!==undefined)clearTimeout(watchdog);refreshingRef.current=false;setRefreshing(false);}
  };
  if (!isOpen || !snapshot) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(submitting.current||refreshingRef.current)return;
    if (!company.trim()) {
      setErrorMsg('请填写投递单位或学校名称。');
      return;
    }
    submitting.current=true;
    setSaving(true);
    setErrorMsg(null);
    try {
      if(queueTask){if(!beforeSubmit)throw Error('缺少岗位流程重新核验。');await beforeSubmit();}
      const now = new Date().toISOString();
      if(queueTask&&!queueRequestId)throw Error('岗位归档缺少固定请求标识，请重新导出。');
      const appId=queueRequestId??requestId.current??crypto.randomUUID();
      requestId.current=appId;
      const entry: JobApplication = {
        id: appId,
        ...(queueTask?{queueTaskId:queueTask.id}:{}),
        company: company.trim(),
        role: role.trim() || snapshot.document.basic.title || '目标岗位',
        city: city.trim(),
        salary: salary.trim(),
        resumeSlug: snapshot.slug || 'resume',
        status,
        appliedDate: queueTask&&status==='wishlist'?'':now.slice(0, 10),
        notes: notes.trim(),
        // Keep the exact pasted source: review offsets and sealed-JD linkage depend on it.
        jdText,
        snapshotId: '',
        exportedFilePath: snapshot.filePath,
        interviewAt: '',
        interviewLocation: '',
        atsScore: queueTask?null:defaultAtsScore,
        updatedAt: now,
      };
      if(snapshot.isRedacted||!snapshot.pdfReceiptToken)throw Error('当前导出没有可用的原稿字节凭证，请重新导出。');
      const saved=await careerLedger.log({entry,document:snapshot.document,pdfReceiptToken:snapshot.pdfReceiptToken});
      onLogged(saved);
      onClose();
    } catch (err) {
      setErrorMsg(localErrorMessage(err,'保存投递快照失败'));
    } finally {
      submitting.current=false;
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="记入投递并锁定永久快照"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-xl border border-slate-700 bg-[#19202c] p-5 text-xs text-slate-100 shadow-2xl space-y-3.5"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <BookmarkCheck size={16} className="text-emerald-400" />
            记入投递并锁定永久原稿快照
          </div>
          <button
            type="button"
            onClick={onClose} disabled={saving||refreshing}
            aria-label="关闭记入投递弹窗"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        <div className="rounded border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-200">
          <div>
            将永久封存当时导出的原稿 JSON 至{' '}
            <code className="font-mono">data/.application-snapshots/</code>（不受 15 份滚动覆盖）。
          </div>
          <div className="mt-1 truncate text-emerald-300/90" title={snapshot.filePath}>
            PDF：{snapshot.filePath}
          </div>
          <div className="mt-1 break-all text-emerald-200/90">SHA256：{snapshot.pdfReceipt.sha256} · {snapshot.pdfReceipt.sizeBytes.toLocaleString()} 字节</div>
          <div className="mt-1 text-slate-300">封存前将重新核验 PDF 字节；不证明实际发送或送达。</div>
          {queueTask&&<p className="mt-1 break-words">固定岗位：{queueTask.company} · {queueTask.role}。默认待投递，须本人确认实际状态；不发送材料。</p>}
        </div>

        {errorMsg && (
          <div className="rounded border border-red-500/40 bg-red-950/60 px-3 py-2 text-[11px] text-red-200">
            {errorMsg}
            {queueTask&&<button type="button" disabled={saving||refreshing} className="ml-2 rounded border px-2 py-1" onClick={()=>void refreshQueueLedger()}>{refreshing?'读取台账中…':'刷新岗位归档台账'}</button>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-slate-300">单位 / 学校名称 *</span>
            <input
              type="text"
              data-native-undo="true"
              readOnly={!!queueTask} value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="如：示例第一中学"
              className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white focus:border-teal-400 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-300">投递岗位</span>
            <input
              type="text"
              data-native-undo="true"
              readOnly={!!queueTask} value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="如：高中物理教师"
              className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white focus:border-teal-400 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-300">城市</span>
            <input
              type="text"
              data-native-undo="true"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="如：示例城市"
              className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white focus:border-teal-400 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-300">薪资 / 编制 / 状态</span>
            <div className="flex gap-1.5">
              <input
                type="text"
                data-native-undo="true"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder="编内 / 薪资"
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-white focus:border-teal-400 focus:outline-none"
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
                aria-label="初始投递状态"
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-white focus:border-teal-400 focus:outline-none"
              >
                {APPLICATION_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {APPLICATION_STATUS_META[st].label}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-slate-300">岗位 JD / 公告原文（可选，便于日后复盘当年要求）</span>
          <textarea
            rows={3}
            data-native-undo="true"
            readOnly={!!queueTask} value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="可粘贴本岗位招聘启事或考核要求..."
            className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-white focus:border-teal-400 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-slate-300">投递备注（可选）</span>
          <input
            type="text"
            data-native-undo="true"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="例如：官网网申 / 校长邮箱直投"
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white focus:border-teal-400 focus:outline-none"
          />
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose} disabled={saving||refreshing}
            className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving||refreshing}
            className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-1.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <BookmarkCheck size={13} />}
            {saving ? '归档中...' : '确认记入并锁定快照'}
          </button>
        </div>
      </form>
    </div>
  );
}
