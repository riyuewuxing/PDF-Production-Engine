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
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, isDesktopMode } from '../../lib/apiClient';
import { type ByokAiSettings, DEFAULT_BYOK_SETTINGS } from '../../lib/byokAiClient';
import {
  COVER_LETTER_VARIANT_LABELS,
  buildApplicationsCsv,
  buildInterviewIcs,
  computeApplicationFunnel,
  resolveCoverLetterHeaderVariant,
} from '../../lib/careerExporter';
import {
  generateCoverLetterBundle,
  generateInterviewQuestions,
  polishCareerTextWithByok,
} from '../../lib/jobToolkit';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_META,
  type ApplicationStatus,
  type ApplicationsStoreData,
  COVER_LETTER_HEADER_VARIANTS,
  type CoverLetterHeaderVariant,
  type JobApplication,
  type SavedCoverLetter,
} from '../../schema/applicationSchema';
import type { ResumeDocument, ResumeSummary } from '../../schema/resumeSchema';

type CareerSubTab = 'tracker' | 'letters' | 'interview';

interface JobCareerPaneProps {
  activeSlug: string;
  activeDoc: ResumeDocument;
  summaries: ResumeSummary[];
  refreshKey?: number;
  onSwitchToResumeForEdit: (slug: string) => void;
  onCloneSnapshot?: (doc: ResumeDocument, suggestedTitle: string) => Promise<void> | void;
  onExportStatus?: (status: { type: 'ok' | 'error'; text: string; filePath?: string }) => void;
}

export function JobCareerPane({
  activeSlug,
  activeDoc,
  summaries,
  refreshKey = 0,
  onSwitchToResumeForEdit,
  onCloneSnapshot,
  onExportStatus,
}: JobCareerPaneProps) {
  const [subTab, setSubTab] = useState<CareerSubTab>('tracker');
  const [storeData, setStoreData] = useState<ApplicationsStoreData>({
    schemaVersion: 1,
    applications: [],
    coverLetters: [],
    interviewAnswers: {},
  });
  const [loading, setLoading] = useState(true);
  const [saveTip, setSaveTip] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tracker draft form
  const [companyDraft, setCompanyDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState('');
  const [cityDraft, setCityDraft] = useState(activeDoc.basic.location || '');
  const [salaryDraft, setSalaryDraft] = useState('');
  const [slugDraft, setSlugDraft] = useState(activeSlug);
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all');
  const [expandedJdId, setExpandedJdId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

  // Cover letter & Interview state
  const [letterCompany, setLetterCompany] = useState('');
  const [letterRole, setLetterRole] = useState(activeDoc.basic.title || '');
  const [letterTitleDraft, setLetterTitleDraft] = useState('');
  const [headerVariantMode, setHeaderVariantMode] = useState<'auto' | CoverLetterHeaderVariant>('auto');
  const [jdOptional, setJdOptional] = useState('');
  const [coverLetterOverride, setCoverLetterOverride] = useState<string | null>(null);
  const [emailBodyOverride, setEmailBodyOverride] = useState<string | null>(null);
  const [bossOverride, setBossOverride] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [exportingLetter, setExportingLetter] = useState(false);
  const [aiSettings, setAiSettings] = useState<ByokAiSettings>(DEFAULT_BYOK_SETTINGS);

  useEffect(() => {
    setSlugDraft(activeSlug);
    if (!letterRole) setLetterRole(activeDoc.basic.title || '');
  }, [activeDoc.basic.title, activeSlug, letterRole]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([apiClient.getApplications(), apiClient.getAiSettings()])
      .then(([apps, ai]) => {
        if (cancelled) return;
        setStoreData({
          ...apps,
          coverLetters: apps.coverLetters ?? [],
        });
        setAiSettings(ai);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : '读取求职追踪数据失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const persistStore = useCallback(async (next: ApplicationsStoreData) => {
    setStoreData(next);
    setErrorMsg(null);
    try {
      const saved = await apiClient.saveApplications(next);
      setStoreData(saved);
      setSaveTip('已保存至 data/applications.json');
      setTimeout(() => setSaveTip(null), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存求职记录失败');
    }
  }, []);

  const handleAddApplication = () => {
    if (!companyDraft.trim()) return;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const entry: JobApplication = {
      id: crypto.randomUUID(),
      company: companyDraft.trim(),
      role: roleDraft.trim() || activeDoc.basic.title || '目标岗位',
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
    setCompanyDraft('');
    setRoleDraft('');
    setSalaryDraft('');
    void persistStore({
      ...storeData,
      applications: [entry, ...storeData.applications],
    });
  };

  const updateApplication = (id: string, patch: Partial<JobApplication>) => {
    const nextList = storeData.applications.map((item) =>
      item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item,
    );
    void persistStore({ ...storeData, applications: nextList });
  };

  const deleteApplication = async (item: JobApplication) => {
    if (item.snapshotId) {
      try {
        await apiClient.deleteApplicationSnapshot(item.snapshotId);
      } catch {
        // Snapshot file may already be gone; still delete the application row cleanly
      }
    }
    await persistStore({
      ...storeData,
      applications: storeData.applications.filter((entry) => entry.id !== item.id),
    });
  };

  const handleCloneSnapshotToWorkspace = async (item: JobApplication) => {
    if (!item.snapshotId || !onCloneSnapshot) return;
    setCloningId(item.id);
    setErrorMsg(null);
    try {
      const record = await apiClient.getApplicationSnapshot(item.snapshotId);
      const cleanName = `${item.company}-${item.role || record.document.title}-复盘版`;
      await onCloneSnapshot(record.document, cleanName);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '读取永久快照失败');
    } finally {
      setCloningId(null);
    }
  };

  const handleExportCsv = async () => {
    setErrorMsg(null);
    try {
      const csv = buildApplicationsCsv(storeData.applications);
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
        role: letterRole || activeDoc.basic.title,
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

  const interviewQuestions = useMemo(
    () => generateInterviewQuestions(activeDoc, letterRole || activeDoc.basic.title),
    [activeDoc, letterRole],
  );

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
        activeDoc.basic.name || '',
        activeDoc.basic.phone ? `电话：${activeDoc.basic.phone}` : '',
        activeDoc.basic.email ? `邮箱：${activeDoc.basic.email}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      const res = await apiClient.exportCoverLetterPdf({
        payload: {
          title: '求职自荐信',
          company: letterCompany.trim() || '贵单位',
          role: letterRole.trim() || activeDoc.basic.title || '目标岗位',
          candidateName: activeDoc.basic.name || '求职者',
          candidateTitle: activeDoc.basic.title || '',
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
    const role = letterRole.trim() || activeDoc.basic.title || '目标岗位';
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
    setLetterTitleDraft('');
    void persistStore({
      ...storeData,
      coverLetters: [entry, ...(storeData.coverLetters ?? [])],
    });
  };

  const handleLoadCoverLetterVersion = (saved: SavedCoverLetter) => {
    setLetterCompany(saved.company);
    setLetterRole(saved.role);
    setCoverLetterOverride(saved.bodyText);
    setHeaderVariantMode(saved.headerVariant);
  };

  const handleDeleteCoverLetterVersion = (id: string) => {
    void persistStore({
      ...storeData,
      coverLetters: (storeData.coverLetters ?? []).filter((item) => item.id !== id),
    });
  };

  const handleByokRefine = async (kind: 'coverLetter' | 'email' | 'boss') => {
    setAiBusy(true);
    setErrorMsg(null);
    try {
      const draft =
        kind === 'coverLetter'
          ? effectiveCoverLetter
          : kind === 'email'
            ? effectiveEmailBody
            : effectiveBossText;
      const out = await polishCareerTextWithByok({
        settings: aiSettings,
        kind,
        company: letterCompany,
        role: letterRole || activeDoc.basic.title,
        draftText: draft,
        jdText: jdOptional,
      });
      if (kind === 'coverLetter') setCoverLetterOverride(out);
      else if (kind === 'email') setEmailBodyOverride(out);
      else setBossOverride(out);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'BYOK 润色失败');
    } finally {
      setAiBusy(false);
    }
  };

  const funnel = useMemo(
    () => computeApplicationFunnel(storeData.applications),
    [storeData.applications],
  );
  const activeFollowups = funnel.wishlist + funnel.applied + funnel.written + funnel.interview;
  const filteredApps =
    statusFilter === 'all'
      ? storeData.applications
      : storeData.applications.filter((a) => a.status === statusFilter);
  const desktop = isDesktopMode();

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <BriefcaseBusiness size={14} className="text-teal-700" />
            <span>求职与面试全周期工作台</span>
          </div>
          {saveTip && <span className="text-[10px] text-emerald-600">{saveTip}</span>}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-0.5 text-[11px] font-medium">
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
            面试追问 ({interviewQuestions.length})
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {errorMsg && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {errorMsg}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 size={16} className="mr-2 animate-spin" /> 正在加载本地求职数据...
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
                      disabled={storeData.applications.length === 0}
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
                      placeholder="城市（如：昆明）"
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
                                  {item.company} · {item.role}
                                </span>
                                {item.snapshotId && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                    <Lock size={9} /> 永久快照已锁定
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
                              {item.snapshotId && onCloneSnapshot && (
                                <button
                                  type="button"
                                  disabled={cloningId === item.id}
                                  onClick={() => void handleCloneSnapshotToWorkspace(item)}
                                  className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                                >
                                  <History size={10} />
                                  {cloningId === item.id ? '恢复中...' : '克隆回工作台'}
                                </button>
                              )}
                              {item.exportedFilePath && desktop && (
                                <button
                                  type="button"
                                  onClick={() => void apiClient.openFile(item.exportedFilePath)}
                                  className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
                                >
                                  <FileText size={10} /> 原 PDF
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
                      placeholder="目标单位（如：示例学校）"
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

                {/* 1. Formal Cover Letter + Version Save */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">1. 正式自荐信 / 求职信</span>
                    <div className="flex items-center gap-1.5">
                      {aiSettings.enabled && (
                        <button
                          type="button"
                          disabled={aiBusy}
                          onClick={() => void handleByokRefine('coverLetter')}
                          className="inline-flex items-center gap-1 rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] text-purple-700 hover:bg-purple-100"
                        >
                          <Sparkles size={11} /> BYOK 精修
                        </button>
                      )}
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

                  {(storeData.coverLetters ?? []).length > 0 && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-2">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                        <Bookmark size={11} className="text-teal-600" />
                        已存自荐信版本库 ({storeData.coverLetters.length})
                      </div>
                      <div className="space-y-1">
                        {storeData.coverLetters.map((saved) => (
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

            {subTab === 'interview' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="font-semibold text-slate-900">
                    基于当前简历生成的 {interviewQuestions.length} 道高频追问（草稿自动落盘）
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    针对你的院校专业、代表性项目与时间线特征离线定制；下方草稿随时自动保存至 <code className="font-mono">data/applications.json</code>。
                  </p>
                </div>

                {interviewQuestions.map((q, idx) => {
                  const answerKey = `${activeSlug}:${q.id}`;
                  return (
                    <div key={q.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-slate-900">
                          <span className="mr-1.5 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-800">
                            Q{idx + 1} · {q.category}
                          </span>
                          {q.question}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        <strong className="text-slate-700">考察意图：</strong>
                        {q.intent}
                      </div>
                      <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
                        {q.starHints.map((hint, hIdx) => (
                          <li key={hIdx}>{hint}</li>
                        ))}
                      </ul>
                      <textarea
                        rows={2}
                        data-native-undo="true"
                        value={storeData.interviewAnswers[answerKey] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          void persistStore({
                            ...storeData,
                            interviewAnswers: {
                              ...storeData.interviewAnswers,
                              [answerKey]: val,
                            },
                          });
                        }}
                        placeholder="在此记录你的 STAR 逐字稿或核心关键词..."
                        className="w-full rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-900 focus:bg-white focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
