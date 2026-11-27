import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileText,
  KeyRound,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Wand2,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type TailorBlockProposal,
  analyzePreparedTailorResponse,
  formatProposalDiagnostics,
  prepareTailorRequest,
  prepareScopedPolishRequest,
  scanFactGuardWarnings,
  scanScopedProposalWarnings,
  type PreparedTailorRequest,
} from '../../lib/aiTailor';
import { apiClient } from '../../lib/apiClient';
import { type AtsInspectionResult, runLiveAtsInspection } from '../../lib/atsInspector';
import {
  BYOK_PROVIDER_PRESETS,
  supportsDeepSeekThinking, aiThinkingLabel, connectionProbeOptions,
  type ByokAiSettings,
  type AiProfileCatalog,
  assertAiPreviewSettings,
  describeAiRequest,
  requestByokCompletionWithReceipt,
  DEFAULT_BYOK_SETTINGS,
  type PolishMode,
  computeLineDiff,
  type AiCompletionResult,
  validateByokBaseUrl,
  type ByokCompletionOptions,
} from '../../lib/byokAiClient';
import { matchResumeWithJd } from '../../lib/jdMatcher';
import { buildAiFactSources, currentSourceCorpus, isShareableFact, PRIVACY_PLACEHOLDER, type AiFactSourceMap } from '../../lib/aiContext';
import { collectEditableBlocks } from '../../lib/resumeBlocks';
import {buildTextPatchEnvelope,previewTextPatch} from '../../lib/aiTextPatch';
import {AI_SKILL_VERSION} from '../../lib/aiSkills';
import {ResumeAiAssistantPane} from './ResumeAiAssistantPane';
import {AiLayoutPane} from './AiLayoutPane';
import {AiTaskReceiptView,receivedAiTask,failedAiTask,type AiTaskReceipt} from './AiTaskReceiptView';
import {FactBankPane} from './FactBankPane';
import type {JobPdfOrigin} from '../../schema/jobPdfSourceSchema';
import {JobNoticePdfPane} from './JobNoticePdfPane';
import {JobRequirementsPane} from './JobRequirementsPane';
import type {FactBank} from '../../schema/factBankSchema';
import {prepareFactSelection,assertFreshFactSelection,loadLocalFactBank,type FactSelection} from '../../lib/factSelection';
import {TextPdfReviewGate} from './TextPdfReviewGate';
import {useTextPdfReview} from '../../hooks/useTextPdfReview';
import { analyzeResumeDiagnostics } from '../../lib/resumeDiagnostics';
import {resumeRevision,type ResumeDocument} from '../../schema/resumeSchema';

type DiagnoseSubTab = 'hr' | 'jd' | 'ats' | 'ai';
type AiSubMode = 'single' | 'tailor' | 'assistant' | 'layout';
type CommonBasis={document:ResumeDocument;slug:string;requestId:string;settings:ByokAiSettings;selection:FactSelection};
type PolishBasis = CommonBasis & { blockKey: string; text: string;polishMode:PolishMode;sourceMap:AiFactSourceMap;kind:'single' };
type TailorBasis = CommonBasis & { jdText: string;masterRef:boolean;masterRevision?:string;kind:'tailor' };
type PendingAiRequest =
  | { mode: 'single'; basis: PolishBasis; settings: ByokAiSettings; options: ByokCompletionOptions; polishMode: PolishMode }
  | { mode: 'tailor'; basis: TailorBasis; settings: ByokAiSettings; prepared: PreparedTailorRequest; masterRef: boolean };

export function DiagnoseAndMatchPane({
  document,
  activeSlug = '',
  overflowPx,
  jdText: controlledJdText,
  jdPdfOrigin,
  onJdTextChange,
  onAtsScoreChange,
  onJumpToSection,
  onImmediateChange,
  onFlushBeforeApply,
  getCurrentRevision,
}: {
  document: ResumeDocument;
  activeSlug?: string;
  overflowPx: number;
  jdText?: string;
  jdPdfOrigin?:JobPdfOrigin;
  onJdTextChange?: (next: string,pdfOrigin?:JobPdfOrigin) => void;
  onAtsScoreChange?: (score: number) => void;
  onJumpToSection: (sectionId: string) => void;
  onImmediateChange: (next: ResumeDocument) => void;
  onFlushBeforeApply: () => Promise<void>;
  getCurrentRevision: () => string;
}) {
  const [subTab, setSubTab] = useState<DiagnoseSubTab>('hr');
  const [jobRewriteApplied,setJobRewriteApplied]=useState<{slug:string;docId:string;source:string}|null>(null);
  const [internalJobSource,setInternalJobSource]=useState<{text:string;pdfOrigin?:JobPdfOrigin}>({text:''});
  const jdText=controlledJdText??internalJobSource.text;
  useEffect(()=>{setJobRewriteApplied(null);},[activeSlug,document.id,jdText]);
  const pdfOrigin=controlledJdText===undefined?internalJobSource.pdfOrigin:jdPdfOrigin;
  const setJdText=onJdTextChange??((next:string,origin?:JobPdfOrigin)=>setInternalJobSource({text:next,pdfOrigin:origin}));

  // 真 ATS 逆向体检 state
  const [atsResult, setAtsResult] = useState<AtsInspectionResult | null>(null);
  const [atsRunning, setAtsRunning] = useState(false);
  const [atsError, setAtsError] = useState<string | null>(null);
  const [showAtsRawText, setShowAtsRawText] = useState(false);

  // BYOK state
  const [aiSubMode, setAiSubMode] = useState<AiSubMode>('single');
  const [aiSettings, setAiSettings] = useState<ByokAiSettings>(DEFAULT_BYOK_SETTINGS);
  const [catalog,setCatalog]=useState<AiProfileCatalog|null>(null);
  const [profileBusy,setProfileBusy]=useState(false);
  const [testingConnection,setTestingConnection]=useState(false);
  const [connectionTip,setConnectionTip]=useState<string|null>(null);
  const [connectionAttempt,setConnectionAttempt]=useState<{settings:ByokAiSettings;value:AiTaskReceipt}|null>(null);
  const testAbort=useRef<AbortController|null>(null);
  useEffect(()=>{setConnectionTip(null);setConnectionAttempt(null);testAbort.current?.abort();},[aiSettings,subTab]);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [showAiConfig, setShowAiConfig] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingAiRequest | null>(null);
  const [factBank,setFactBank]=useState<FactBank|null>(null);
  const [factIds,setFactIds]=useState<string[]>([]);
  const [factsBusy,setFactsBusy]=useState(false);

  const editableBlocks = useMemo(() => collectEditableBlocks(document), [document]);
  const [selectedBlockKey, setSelectedBlockKey] = useState<string>(() => editableBlocks[0]?.key ?? 'skills');
  const [polishMode, setPolishMode] = useState<PolishMode>('star');
  const [polishing, setPolishing] = useState(false);
  const [singleAttempt,setSingleAttempt]=useState<AiTaskReceipt|null>(null);
  const [wholeAttempt,setWholeAttempt]=useState<AiTaskReceipt|null>(null);
  const [polishError, setPolishError] = useState<string | null>(null);
  const polishErrorElement=useRef<HTMLDivElement|null>(null);
  const [suggestedText, setSuggestedText] = useState<string | null>(null);
  const [polishRiskConfirmed, setPolishRiskConfirmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const polishAbortRef = useRef<AbortController | null>(null);
  const polishBasisRef = useRef<PolishBasis | null>(null);
  const tailorBasisRef = useRef<TailorBasis | null>(null);
  const mountedRef = useRef(false);

  // Tailor whole-resume state
  const [tailorUseMasterRef, setTailorUseMasterRef] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const tailorErrorElement=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{if(polishError&&aiSubMode==='single')polishErrorElement.current?.scrollIntoView({block:'nearest'});},[polishError,aiSubMode]);
  useEffect(()=>{if(tailorError&&aiSubMode==='tailor')tailorErrorElement.current?.scrollIntoView({block:'nearest'});},[tailorError,aiSubMode]);
  const [tailorProposals, setTailorProposals] = useState<TailorBlockProposal[]>([]);
  const [tailorSources, setTailorSources] = useState<AiFactSourceMap>({});
  const [tailorEditingKey, setTailorEditingKey] = useState<string | null>(null);
  const [tailorNotice, setTailorNotice] = useState<string | null>(null);
  const tailorAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    void (window.resumeDesktop?apiClient.listAiProfiles().then(c=>{
      if(mountedRef.current)setCatalog(c);
      const selected=c.profiles.find(p=>p.profileId===c.activeProfileId);
      if(!selected)throw new Error('当前模型档案不存在。');return selected;
    }):apiClient.getAiSettings()).then((settings) => {
      if (mountedRef.current) setAiSettings(settings);
    }).catch((err: unknown) => {
      if (mountedRef.current) setSettingsError(err instanceof Error ? err.message : '无法读取 AI 配置。');
    });
    return () => {
      mountedRef.current = false;
      polishAbortRef.current?.abort();
      tailorAbortRef.current?.abort();
      testAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!editableBlocks.some((b) => b.key === selectedBlockKey) && editableBlocks[0]) {
      setSelectedBlockKey(editableBlocks[0].key);
    }
  }, [editableBlocks, selectedBlockKey]);

  const diagnostic = useMemo(
    () => analyzeResumeDiagnostics(document, { overflowPx }),
    [document, overflowPx],
  );

  const jdResult = useMemo(() => matchResumeWithJd(document, jdText), [document, jdText]);

  const selectedBlock = editableBlocks.find((b) => b.key === selectedBlockKey) ?? editableBlocks[0];
  const factKeys=aiSubMode==='single'?(selectedBlock?[selectedBlock.key]:[]):editableBlocks.map(b=>b.key);
  const contextRef = useRef({ document, slug: activeSlug, jdText, blockKey: selectedBlock?.key, aiSettings, aiSubMode, polishMode, tailorUseMasterRef, subTab,factBank,factIds });
  contextRef.current = { document, slug: activeSlug, jdText, blockKey: selectedBlock?.key, aiSettings, aiSubMode, polishMode, tailorUseMasterRef, subTab,factBank,factIds };
  const currentSources = useMemo(() => buildAiFactSources(document), [document]);
  const polishWarnings = useMemo(
    () => suggestedText === null || !selectedBlock ? [] :
      scanFactGuardWarnings(suggestedText, currentSourceCorpus(currentSources[selectedBlock.key] ?? [])),
    [suggestedText, selectedBlock, currentSources],
  );
  const isCurrent = (basis: PolishBasis|TailorBasis) => {
    const c=contextRef.current;
    return mountedRef.current&&c.document===basis.document&&c.slug===basis.slug&&c.aiSettings===basis.settings&&c.subTab==='ai'&&c.aiSubMode===basis.kind&&
      JSON.stringify(c.factIds)===JSON.stringify(basis.selection.records.map(r=>r.id))&&
      (!basis.selection.binding||c.factBank?.revision===basis.selection.binding.bankRevision)&&
      (basis.kind==='single'?c.blockKey===basis.blockKey&&c.polishMode===basis.polishMode:c.jdText===basis.jdText&&c.tailorUseMasterRef===basis.masterRef);
  };
  const assertFactsFresh=async(basis:PolishBasis|TailorBasis)=>{
    await assertFreshFactSelection(basis.document,basis.selection,loadLocalFactBank);
    if(basis.kind==='tailor'&&basis.masterRevision&&resumeRevision(await apiClient.getResume('master'))!==basis.masterRevision)throw new Error('参考母库已变化，请重新预览；旧审批作废。');
    if(!isCurrent(basis))throw new Error('任务范围、模型或事实选择已变化，请重新预览。');
  };
  const clearTextApprovals=()=>{
    setPendingRequest(null);setSuggestedText(null);setPolishRiskConfirmed(false);setSingleAttempt(null);setWholeAttempt(null);
    polishBasisRef.current=null;tailorBasisRef.current=null;
    setTailorProposals([]);setTailorSources({});setTailorNotice(null);setTailorEditingKey(null);
    polishAbortRef.current?.abort();tailorAbortRef.current?.abort();
  };

  const singleBasis=polishBasisRef.current;
  const singleCandidates=singleBasis&&suggestedText!==null&&selectedBlock&&selectedBlock.key===singleBasis.blockKey?[{blockKey:singleBasis.blockKey,originalText:singleBasis.text,suggestedText,reason:'单段精修（人工核对）',factIds:(currentSources[singleBasis.blockKey]??[]).map(s=>s.id)}]:[];
  const singleReview=useTextPdfReview({document,slug:activeSlug,requestId:singleBasis?.requestId??'',enabled:subTab==='ai'&&aiSubMode==='single'&&polishRiskConfirmed&&!!singleBasis&&isCurrent(singleBasis)&&!polishing&&!factsBusy,candidates:singleCandidates,validate:singleBasis?()=>assertFactsFresh(singleBasis):undefined});
  const wholeBasis=tailorBasisRef.current;
  const wholeCandidates=tailorProposals.filter(p=>p.accepted);
  const wholeReview=useTextPdfReview({document,slug:activeSlug,requestId:wholeBasis?.requestId??'',enabled:subTab==='ai'&&aiSubMode==='tailor'&&!!wholeBasis&&isCurrent(wholeBasis)&&!tailoring&&!factsBusy,candidates:wholeCandidates,validate:wholeBasis?()=>assertFactsFresh(wholeBasis):undefined});
  useEffect(() => {
    setSuggestedText(null);
    setPolishRiskConfirmed(false);
    polishAbortRef.current?.abort();
  }, [document, activeSlug, selectedBlock?.key]);

  useEffect(() => {
    setTailorProposals([]);
    setTailorSources({});
    setTailorNotice(null);
    tailorAbortRef.current?.abort();
  }, [document, activeSlug, jdText]);
  useEffect(() => {
    setPendingRequest(null);
  }, [document, activeSlug, jdText, selectedBlock?.key, aiSettings, aiSubMode, polishMode, tailorUseMasterRef, subTab]);
  useEffect(()=>{setFactIds([]);clearTextApprovals();},[document,activeSlug,selectedBlock?.key,aiSettings,aiSubMode,polishMode,tailorUseMasterRef,subTab,jdText]);
  const diffSegments = useMemo(
    () =>
      selectedBlock && suggestedText !== null
        ? computeLineDiff(selectedBlock.text, suggestedText)
        : [],
    [selectedBlock, suggestedText],
  );

  const scoreColor =
    diagnostic.score >= 85
      ? 'text-emerald-600 border-emerald-500 bg-emerald-50'
      : diagnostic.score >= 65
        ? 'text-amber-600 border-amber-500 bg-amber-50'
        : 'text-red-600 border-red-500 bg-red-50';

  const atsScoreColor = atsResult
    ? atsResult.score >= 85
      ? 'text-emerald-600 border-emerald-500 bg-emerald-50'
      : atsResult.score >= 65
        ? 'text-amber-600 border-amber-500 bg-amber-50'
        : 'text-red-600 border-red-500 bg-red-50'
    : '';

  const handleRunAtsInspection = async () => {
    setAtsRunning(true);
    setAtsError(null);
    try {
      const result = await runLiveAtsInspection(document, jdText);
      setAtsResult(result);
      onAtsScoreChange?.(result.score);
    } catch (err) {
      setAtsError(err instanceof Error ? err.message : 'ATS 逆向体检失败');
    } finally {
      setAtsRunning(false);
    }
  };

  const handleSaveAiSettings = async () => {
    if(profileBusy)return;
    setProfileBusy(true);
    setSettingsError(null);
    setSettingsSavedMsg(null);setConnectionTip(null);
    try {
      const saved = await apiClient.saveAiSettings(aiSettings);
      setAiSettings(saved);
      if(window.resumeDesktop)setCatalog(await apiClient.listAiProfiles());
      setPendingRequest(null);
      setSettingsSavedMsg(window.resumeDesktop ? '配置已保存；密钥由系统加密保护。' : '浏览器模式：配置仅在当前页面内存中有效。');
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'AI 配置保存失败。');
    }finally{setProfileBusy(false);}
  };

  const changeProfile=async(action:()=>Promise<AiProfileCatalog>)=>{
    if(profileBusy||testingConnection||polishing||tailoring||applyingRef.current)return;
    const old=catalog?.profiles.find(p=>p.profileId===aiSettings.profileId);
    if(old&&JSON.stringify(old)!==JSON.stringify(aiSettings)&&!window.confirm('当前档案有未保存的编辑。切换或管理档案将放弃这些编辑，继续吗？'))return;
    setProfileBusy(true);setSettingsError(null);setSettingsSavedMsg(null);setConnectionTip(null);
    try{const c=await action();const active=c.profiles.find(p=>p.profileId===c.activeProfileId);
      if(!active)throw new Error('当前模型档案不存在。');
      setCatalog(c);setAiSettings(active);setPendingRequest(null);
    }catch(err){setSettingsError(err instanceof Error?err.message:'模型档案操作失败。');}
    finally{setProfileBusy(false);}
  };
  const assertPreviewSettings = (settings: ByokAiSettings,options?:ByokCompletionOptions) => {
    if(profileBusy)throw new Error('模型配置操作尚未完成。');
    assertAiPreviewSettings(settings,options);
    const saved=catalog?.profiles.find(p=>p.profileId===settings.profileId);
    if(window.resumeDesktop&&(!saved||JSON.stringify(saved)!==JSON.stringify(settings)))throw new Error('配置已编辑，请先保存或重新读取。');
  };

  const testConnection=async()=>{
    if(testAbort.current||profileBusy||polishing||tailoring)return;
    setConnectionTip(null);setConnectionAttempt(null);setSettingsError(null);
    let ctrl:AbortController|undefined,response:AiCompletionResult|undefined;
    const settings=aiSettings;
    try{
      const options=connectionProbeOptions(settings);
      assertPreviewSettings(settings,options);
      ctrl=new AbortController();testAbort.current=ctrl;setTestingConnection(true);
      response=await requestByokCompletionWithReceipt({...options,settings,signal:ctrl.signal});
      if(mountedRef.current&&contextRef.current.aiSettings===settings&&contextRef.current.subTab==='ai'&&!ctrl.signal.aborted){setConnectionTip(response.text.trim()==='OK'?'连接成功 · 合成探针返回 OK':'连接成功 · 收到非空文本（尚未验证其他能力）');setConnectionAttempt({settings,value:receivedAiTask(response)});}
    }catch(err){if(mountedRef.current&&contextRef.current.aiSettings===settings&&contextRef.current.subTab==='ai'&&!ctrl?.signal.aborted){if(ctrl)setConnectionAttempt({settings,value:failedAiTask(response,err)});setSettingsError(err instanceof Error?err.message:'连接测试失败。');}}
    finally{if(testAbort.current===ctrl){if(ctrl?.signal.aborted&&mountedRef.current&&contextRef.current.aiSettings===settings&&contextRef.current.subTab==='ai')setConnectionAttempt({settings,value:{status:'cancelled'}});testAbort.current=null;if(mountedRef.current)setTestingConnection(false);}}
  };
  const handlePreparePolish = () => {
    if (!selectedBlock || applyingRef.current || polishing || factsBusy) return;
    clearTextApprovals();
    setPolishError(null);
    setPendingRequest(null);
    try {
      assertPreviewSettings(aiSettings);
      const selection=prepareFactSelection(document,activeSlug,[selectedBlock.key],factBank,factIds);
      const prepared=prepareScopedPolishRequest({document,blockKey:selectedBlock.key,mode:polishMode,records:selection.records});
      const basis:PolishBasis={kind:'single',document,slug:activeSlug,blockKey:selectedBlock.key,text:selectedBlock.text,requestId:crypto.randomUUID(),settings:aiSettings,polishMode,selection,sourceMap:prepared.sourceMap};
      const options=prepared.options;
      if(selection.binding)options.factBinding=selection.binding;
      assertPreviewSettings(aiSettings,options);
      setPendingRequest({ mode:'single', basis, settings:aiSettings, options, polishMode });
    } catch(err) {
      setPolishError(err instanceof Error ? err.message : '无法准备发送内容。');
    }
  };

  const handleRunPolish = async (request: Extract<PendingAiRequest,{mode:'single'}>) => {
    if (!isCurrent(request.basis) || applyingRef.current) return;
    polishAbortRef.current?.abort();
    const controller = new AbortController();
    polishAbortRef.current = controller;
    const basis = request.basis;
    polishBasisRef.current = basis;
    setPolishing(true);
    setPolishError(null);
    setSuggestedText(null);
    setPolishRiskConfirmed(false);setSingleAttempt(null);
    let response:AiCompletionResult|undefined;
    try {
      await assertFactsFresh(basis);
      if(controller.signal.aborted)return;
      response = await requestByokCompletionWithReceipt({...request.options,settings:request.settings,signal:controller.signal});
      const output=response.text;
      await assertFactsFresh(basis);
      if (controller.signal.aborted || polishAbortRef.current !== controller || !isCurrent(basis)) return;
      const block = editableBlocks.find(b=>b.key===basis.blockKey);
      if (!block || output.length > block.maxCharsHint) throw new Error('润色结果超出段落字数预算，请缩短后重试。');
      if (output.includes(PRIVACY_PLACEHOLDER)) throw new Error('模型保留了隐私省略标记，未生成可直接应用的建议。');
      setSuggestedText(output);setSingleAttempt(receivedAiTask(response));
    } catch (err) {
      if (polishAbortRef.current === controller && isCurrent(basis) && !controller.signal.aborted) {
        setSingleAttempt(failedAiTask(response,err));
        setPolishError(err instanceof Error ? err.message : '润色请求失败');
      }
    } finally {
      if (polishAbortRef.current === controller && mountedRef.current) setPolishing(false);
    }
  };

  const handleAdoptDiff = async () => {
    const basis = polishBasisRef.current;
    if (!basis || !selectedBlock || suggestedText === null || applyingRef.current ||
        !isCurrent(basis) || selectedBlock.key !== basis.blockKey || selectedBlock.text !== basis.text) {
      setPolishError('原简历或段落已变化，请重新生成润色建议。');
      setSuggestedText(null);
      return;
    }
    if(!singleReview.canApply){setPolishError('请先完成当前候选真实 PDF 对照和批准。');return;}
    if (!polishRiskConfirmed) {
      setPolishError('请逐项核对新事实风险后再确认采纳。');
      return;
    }
    if (!activeSlug) { setPolishError('未找到当前简历版本，无法安全应用。'); return; }
    if(activeSlug==='master'&&!window.confirm('当前目标是母库。确认创建快照后应用已核对的 AI 正文修改？'))return;
    applyingRef.current = true;
    setApplying(true);
    try {
      await onFlushBeforeApply();
      if (!isCurrent(basis)) throw new Error('简历已变化，请重新生成润色建议。');
      const revision=getCurrentRevision();
      const envelope=await buildTextPatchEnvelope({document,slug:activeSlug,baseRevision:revision,sourceRequestId:basis.requestId,candidates:[{blockKey:basis.blockKey,originalText:basis.text,suggestedText,reason:'单段精修（人工核对）',factIds:(currentSources[basis.blockKey]??[]).map(s=>s.id)}]});
      const next=await previewTextPatch({document,slug:activeSlug,revision,envelope});
      if(!singleReview.matches(next))throw new Error('单段候选与已审核 PDF 不一致。');
      if(!isCurrent(basis)||getCurrentRevision()!==revision)throw new Error('简历版本已变化，未应用修改。');
      await assertFactsFresh(basis).catch(err=>{singleReview.invalidate();throw err;});
      await apiClient.createSnapshot(activeSlug,'AI 单段润色前快照',revision);
      await assertFactsFresh(basis).catch(err=>{singleReview.invalidate();throw err;});
      if (!isCurrent(basis)||getCurrentRevision()!==revision||!singleReview.matches(next)) throw new Error('简历或审批已变化，请重新生成润色建议。');
      onImmediateChange(next);
      setPolishError(null);
      setSuggestedText(null);setFactIds([]);
    } catch (err) {
      if (mountedRef.current)setPolishError(err instanceof Error ? err.message : '保存或快照失败，未应用修改。');
    } finally {
      applyingRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
  };

  const handlePrepareTailor = async () => {
    if (applyingRef.current || tailoring || factsBusy) return;
    clearTextApprovals();
    tailorAbortRef.current?.abort();
    const controller = new AbortController();
    tailorAbortRef.current = controller;
    const settings = aiSettings;
    const masterRef = tailorUseMasterRef;
    let basis:TailorBasis|undefined;
    setTailoring(true);
    setTailorError(null);
    setPendingRequest(null);
    try {
      assertPreviewSettings(settings);
      const selection=prepareFactSelection(document,activeSlug,editableBlocks.map(b=>b.key),factBank,factIds);
      basis={kind:'tailor',document,slug:activeSlug,jdText,requestId:crypto.randomUUID(),settings,masterRef,selection};
      let masterDoc: ResumeDocument | null = null;
      if (masterRef && activeSlug !== 'master') masterDoc = await apiClient.getResume('master');
      if (controller.signal.aborted || !isCurrent(basis) || contextRef.current.aiSettings !== settings ||
          contextRef.current.tailorUseMasterRef !== masterRef || contextRef.current.aiSubMode !== 'tailor' ||
          contextRef.current.subTab !== 'ai') return;
      if(masterDoc){basis.masterRevision=resumeRevision(masterDoc);if(selection.binding)selection.binding={...selection.binding,masterRevision:basis.masterRevision};}
      const prepared = prepareTailorRequest({document,masterDocument:masterDoc,jdText,records:selection.records});
      if(selection.binding)prepared.options.factBinding=selection.binding;
      assertPreviewSettings(settings,prepared.options);
      setPendingRequest({mode:'tailor',basis,settings,prepared,masterRef});
    } catch(err) {
      if (!basis||isCurrent(basis)) setTailorError(err instanceof Error?err.message:'无法准备整卷请求。');
    } finally {
      if(tailorAbortRef.current===controller&&mountedRef.current)setTailoring(false);
    }
  };

  const handleRunTailor = async (request: Extract<PendingAiRequest,{mode:'tailor'}>) => {
    if (applyingRef.current || !isCurrent(request.basis)) return;
    tailorAbortRef.current?.abort();
    const controller = new AbortController();
    tailorAbortRef.current = controller;
    const basis = request.basis;
    tailorBasisRef.current = basis;
    setTailoring(true);
    setTailorError(null);
    setTailorNotice(null);
    setTailorProposals([]);setWholeAttempt(null);
    let response:AiCompletionResult|undefined;
    try {
      await assertFactsFresh(basis);
      if(controller.signal.aborted)return;
      response = await requestByokCompletionWithReceipt({...request.prepared.options,settings:request.settings,signal:controller.signal});
      await assertFactsFresh(basis);
      if (controller.signal.aborted || tailorAbortRef.current !== controller || !isCurrent(basis)) return;
      const res=analyzePreparedTailorResponse(response.text,request.prepared);
      setWholeAttempt(res.proposals.length?receivedAiTask(response):failedAiTask(response));
      setTailorProposals(res.proposals);
      setTailorSources(res.sourceMap);
      setTailorNotice((res.proposals.length===0?'模型没有返回可用的改写提案；这不代表岗位要求已经全部匹配。 ':'')+formatProposalDiagnostics(res.diagnostics));
    } catch (err) {
      if (tailorAbortRef.current !== controller || !isCurrent(basis) || controller.signal.aborted) return;
      setWholeAttempt(failedAiTask(response,err));
      setTailorError(err instanceof Error ? err.message : '整卷定向改写失败');
    } finally {
      if (tailorAbortRef.current === controller && mountedRef.current) setTailoring(false);
    }
  };

  const confirmPendingRequest = () => {
    const request = pendingRequest;
    if (!request||factsBusy||polishing||tailoring||applyingRef.current) return;
    setPendingRequest(null);
    const current = contextRef.current;
    if (!isCurrent(request.basis) || current.aiSettings !== request.settings ||
        current.aiSubMode !== request.mode || current.subTab !== 'ai' ||
        (request.mode === 'single' ? current.polishMode !== request.polishMode : current.tailorUseMasterRef !== request.masterRef)) {
      const message = '发送范围或设置已变化，请重新预览确认。';
      if (request.mode === 'single') setPolishError(message); else setTailorError(message);
      return;
    }
    if (request.mode === 'single') void handleRunPolish(request); else void handleRunTailor(request);
  };

  const handleApplyTailorProposals = async () => {
    const selected = tailorProposals.filter((p) => p.accepted);
    if (selected.length === 0 || applyingRef.current || !wholeReview.canApply) return;
    const basis = tailorBasisRef.current;
    if (!basis || !isCurrent(basis) || !activeSlug) {
      setTailorError('简历版本或岗位要求已变化，请重新生成提案。');
      return;
    }
    for (const item of selected) {
      const block = editableBlocks.find((b) => b.key === item.blockKey);
      const warnings = scanScopedProposalWarnings(item.suggestedText, item.blockKey, tailorSources, item.factIds);
      if (!block || block.text !== item.originalText || !item.suggestedText.trim() ||
          item.suggestedText.length > block.maxCharsHint || item.suggestedText.includes(PRIVACY_PLACEHOLDER) ||
          JSON.stringify(warnings) !== JSON.stringify(item.factWarnings)) {
        setTailorError('提案已变化、超出字数上限或事实风险未重新确认，未应用修改。');
        return;
      }
    }
    if(activeSlug==='master'&&!window.confirm('当前目标是母库。确认创建快照后应用已核对的 AI 正文修改？'))return;
    applyingRef.current = true;
    setApplying(true);
    try {
      await onFlushBeforeApply();
      if (!isCurrent(basis)) throw new Error('简历已变化，未应用修改。');
      const revision=getCurrentRevision();
      const envelope=await buildTextPatchEnvelope({document,slug:activeSlug,baseRevision:revision,sourceRequestId:basis.requestId,candidates:selected});
      const next=await previewTextPatch({document,slug:activeSlug,revision,envelope});
      if(!wholeReview.matches(next))throw new Error('整卷候选与已审核 PDF 不一致。');
      if(!isCurrent(basis)||getCurrentRevision()!==revision)throw new Error('简历版本已变化，未应用修改。');
      await assertFactsFresh(basis).catch(err=>{wholeReview.invalidate();throw err;});
      await apiClient.createSnapshot(activeSlug,'AI 整卷定向改写前快照',revision);
      await assertFactsFresh(basis).catch(err=>{wholeReview.invalidate();throw err;});
      if (!isCurrent(basis)||getCurrentRevision()!==revision||!wholeReview.matches(next)) throw new Error('简历或审批已变化，未应用修改。');
      onImmediateChange(next);
      setTailorError(null);
      setTailorProposals([]);setFactIds([]);
      setTailorNotice(`已一次性应用 ${selected.length} 条整卷改写（按 Ctrl+Z 可 1 步完整撤回）。`);
    } catch (err) {
      if (mountedRef.current)setTailorError(err instanceof Error ? err.message : '保存或快照失败，未应用修改。');
    } finally {
      applyingRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <div className="text-xs font-bold text-slate-900">诊断优化中心</div>
        <div className="text-[11px] text-slate-500">0 成本离线 HR 体检 · JD 关键词雷达 · 可选本地/BYOK 润色</div>

        <div className="mt-2.5 grid grid-cols-4 gap-1 rounded-md bg-slate-100 p-0.5 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setSubTab('hr')}
            className={`inline-flex items-center justify-center gap-1 rounded py-1 transition ${
              subTab === 'hr' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Stethoscope size={12} /> HR 体检
          </button>
          <button
            type="button"
            onClick={() => setSubTab('jd')}
            className={`inline-flex items-center justify-center gap-1 rounded py-1 transition ${
              subTab === 'jd' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Radar size={12} /> JD 雷达
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ats')}
            className={`inline-flex items-center justify-center gap-1 rounded py-1 transition ${
              subTab === 'ats' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText size={12} /> 真 ATS 机读
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ai')}
            className={`inline-flex items-center justify-center gap-1 rounded py-1 transition ${
              subTab === 'ai' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles size={12} /> AI 润色 Diff
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 text-xs">
        {subTab === 'hr' && (
          <div className="space-y-4">
            {/* Overall Score Card */}
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div
                aria-label="HR体检综合分"
                className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-4 font-bold ${scoreColor}`}
              >
                <span className="text-xl leading-none">{diagnostic.score}</span>
                <span className="text-[9px] font-normal">分</span>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-bold text-slate-900">离线确定性简历体检评分</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                  <span>有效字数：{diagnostic.metrics.totalChars} 字</span>
                  <span>经历量化率：{diagnostic.metrics.quantifiedRate}%</span>
                  <span>
                    含指标经历：{diagnostic.metrics.quantifiedEntries}/{diagnostic.metrics.totalEntries}
                  </span>
                  <span>未留空混排：{diagnostic.metrics.unspacedCjkHits} 处</span>
                </div>
              </div>
            </div>

            {/* Findings List */}
            <div className="space-y-2.5">
              {diagnostic.findings.map((finding) => {
                const badgeStyle =
                  finding.severity === 'error'
                    ? 'border-red-200 bg-red-50/80 text-red-900'
                    : finding.severity === 'warn'
                      ? 'border-amber-200 bg-amber-50/80 text-amber-900'
                      : 'border-emerald-200 bg-emerald-50/70 text-emerald-900';

                return (
                  <div key={finding.id} className={`rounded-lg border p-3 ${badgeStyle}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        {finding.severity === 'error' ? (
                          <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-600" />
                        ) : finding.severity === 'warn' ? (
                          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                        ) : (
                          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                        )}
                        <div>
                          <span className="mr-1.5 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold">
                            {finding.category}
                          </span>
                          <span className="font-semibold">{finding.title}</span>
                          <p className="mt-1 text-[11px] leading-relaxed opacity-85">{finding.detail}</p>
                        </div>
                      </div>
                      {finding.sectionId && (
                        <button
                          type="button"
                          onClick={() => onJumpToSection(finding.sectionId!)}
                          className="inline-flex shrink-0 items-center gap-0.5 rounded border border-current/25 bg-white px-2 py-1 text-[11px] font-semibold hover:bg-slate-50"
                        >
                          定位修复 <ArrowUpRight size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {subTab === 'jd' && (
          <div className="space-y-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-semibold text-slate-800">粘贴目标岗位招聘 JD / 考编公告条件</span>
              <textarea
                rows={6}
                data-native-undo="true"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="例如：招聘高中物理教师，要求硕士及以上学历，持有高中物理教师资格证，熟悉新高考课程标准与实验教学，具备班级管理、班主任经验或 AI 智慧课堂/可视化课件开发能力者优先..."
                className="w-full rounded-lg border border-slate-200 p-2.5 text-xs leading-relaxed text-slate-900 focus:border-teal-500 focus:outline-none"
              />
            </label>

            <JobNoticePdfPane jdText={jdText} origin={pdfOrigin} onConfirm={setJdText}/>
            {jobRewriteApplied?.slug===activeSlug&&jobRewriteApplied.docId===document.id&&jobRewriteApplied.source===jdText&&<p role="status" className="rounded border border-teal-200 bg-teal-50 p-2 text-teal-900">已将核对后的岗位定向正文修改提交至编辑器；保存以工作台状态为准。原岗位核对会话因简历变化失效，请重新分析。可使用 Ctrl+Z 撤回正文修改。</p>}
            <JobRequirementsPane document={document} slug={activeSlug} jdText={jdText} pdfOrigin={pdfOrigin} onJdTextChange={setJdText} onFlush={onFlushBeforeApply} getRevision={getCurrentRevision} rewriteActions={{overflowPx,onFlushBeforeApply,getCurrentRevision,onImmediateChange:next=>{onImmediateChange(next);setJobRewriteApplied({slug:activeSlug,docId:next.id,source:jdText});}}}/>
            {jdResult.totalKeywords > 0 ? (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">JD 关键词覆盖度雷达</span>
                  <span className="rounded-full bg-teal-600 px-2.5 py-0.5 font-mono text-xs font-bold text-white">
                    {jdResult.coveragePercent}%（{jdResult.matchedCount}/{jdResult.totalKeywords}）
                  </span>
                </div>

                <div>
                  <div className="mb-1.5 font-semibold text-emerald-700">
                    简历已命中（{jdResult.matchedKeywords.length}）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {jdResult.matchedKeywords.length === 0 ? (
                      <span className="text-[11px] text-slate-400">暂无直接命中关键词</span>
                    ) : (
                      jdResult.matchedKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
                        >
                          ✓ {kw}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 font-semibold text-amber-700">
                    JD 文字线索未命中（需先核实真实经历，{jdResult.missingKeywords.length}）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {jdResult.missingKeywords.length === 0 ? (
                      <span className="text-[11px] text-emerald-600">已覆盖提取的词语，不代表满足招聘条件。</span>
                    ) : (
                      jdResult.missingKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                        >
                          + {kw}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-[11px] text-slate-400">
                在上方粘贴任意招聘 JD 文本，离线引擎将即刻分析关键词命中率。
              </div>
            )}
          </div>
        )}

        {subTab === 'ats' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="font-bold text-slate-900">把导出的 PDF 再读回来</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                在内存中把当前简历渲染成与正式导出完全一致的矢量 A4 PDF，再解析出招聘系统真正读到的文本流。
                全程不落盘、不产生快照、不改动原稿。
              </p>
              <button
                type="button"
                disabled={atsRunning}
                onClick={() => void handleRunAtsInspection()}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <FileText size={13} />
                {atsRunning ? '渲染并解析中…' : atsResult ? '重新体检' : '运行真 ATS 逆向体检'}
              </button>
              {jdText.trim() ? (
                <p className="mt-1.5 text-[10px] text-emerald-700">
                  已自动带入「JD 雷达」中的 JD，将额外核验关键词机读命中。
                </p>
              ) : (
                <p className="mt-1.5 text-[10px] text-slate-400">
                  提示：先到「JD 雷达」粘贴 JD，可额外核验关键词是否真被机读。
                </p>
              )}
              {atsError && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  {atsError}
                </div>
              )}
            </div>

            {atsResult && (
              <>
                <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <div
                    aria-label="ATS 机读得分"
                    className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-4 font-bold ${atsScoreColor}`}
                  >
                    <span className="text-xl leading-none">{atsResult.score}</span>
                    <span className="text-[9px] font-normal">分</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-bold text-slate-900">ATS 机读还原评分</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                      <span>页数：{atsResult.pageCount}</span>
                      <span>有效字符：{atsResult.charCount}</span>
                      <span>
                        栏结构：
                        {atsResult.columnsDetected
                          ? `双栏（${atsResult.columnPageCount} 页）`
                          : '单栏线性'}
                      </span>
                      <span>跨栏拼接行：{atsResult.interleavedLineCount}</span>
                      <span>乱码字符：{atsResult.garbledCharCount}</span>
                      <span>部首替换：{atsResult.compatCharCount}</span>
                      <span>实体覆盖率：{Math.round(atsResult.coverageRatio * 100)}%</span>
                      {atsResult.jdPdfHitRate !== null && (
                        <span>JD 机读命中：{atsResult.jdPdfHitRate}%</span>
                      )}
                      {atsResult.jdMissedInPdfOnly.length > 0 && (
                        <span className="text-amber-700">
                          正文有但读不出：{atsResult.jdMissedInPdfOnly.length} 个词
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {atsResult.checks.map((check) => {
                    const style =
                      check.severity === 'error'
                        ? 'border-red-200 bg-red-50/80 text-red-900'
                        : check.severity === 'warn'
                          ? 'border-amber-200 bg-amber-50/80 text-amber-900'
                          : 'border-emerald-200 bg-emerald-50/70 text-emerald-900';
                    return (
                      <div key={check.id} className={`rounded-lg border p-3 ${style}`}>
                        <div className="flex items-start gap-2">
                          {check.severity === 'error' ? (
                            <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-600" />
                          ) : check.severity === 'warn' ? (
                            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                          ) : (
                            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                          )}
                          <div>
                            <span className="font-semibold">{check.label}</span>
                            {check.penalty > 0 && (
                              <span className="ml-1.5 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold">
                                -{check.penalty}
                              </span>
                            )}
                            <p className="mt-1 text-[11px] leading-relaxed opacity-85">{check.detail}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowAtsRawText((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <span>{showAtsRawText ? '收起' : '查看'}原始 ATS 机读纯文本流</span>
                    <span className="text-[10px] font-normal text-slate-400">只读</span>
                  </button>
                  {showAtsRawText && (
                    <div className="space-y-2 border-t border-slate-200 p-2.5">
                      <div>
                        <div className="mb-1 text-[10px] font-bold text-slate-500">
                          ATS 原始流（朴素自上而下）
                        </div>
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] leading-relaxed text-slate-700">
                          {atsResult.rawExtractedText || '（无文本）'}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] font-bold text-slate-500">
                          双栏感知顺序（人类阅读顺序）
                        </div>
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 font-mono text-[10px] leading-relaxed text-slate-700">
                          {atsResult.columnAwareText || '（无文本）'}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {subTab === 'ai' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                  <ShieldCheck size={14} className="text-teal-600" />
                  AI 模型中心 · 多配置档案
                </div>
                <button
                  type="button"
                  onClick={() => setShowAiConfig((v) => !v)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                >
                  <KeyRound size={11} /> {showAiConfig ? '收起设置' : aiSettings.enabled ? '已启用 · 修改' : '去配置'}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                默认关闭。桌面端密钥由系统加密保护，已保存密钥不再回传界面；模型请求由主进程发送。浏览器模式不持久化密钥。技能版本：{AI_SKILL_VERSION}。
              </p>

              {settingsError && <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-700">{settingsError}</div>}
              {showAiConfig && (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  {catalog&&<div className="space-y-2 rounded border border-teal-200 bg-white p-2">
                    <label className="block font-semibold">当前模型档案</label>
                    <select aria-label="当前模型档案" value={aiSettings.profileId} disabled={profileBusy||testingConnection||polishing||tailoring} onChange={e=>{const id=e.target.value;void changeProfile(()=>apiClient.activateAiProfile(id));}} className="w-full rounded border border-slate-300 p-1.5">
                      {catalog.profiles.map(p=><option key={p.profileId} value={p.profileId}>{p.providerLabel} · {p.model}{p.enabled?'':'（未启用）'}</option>)}
                    </select>
                    <button type="button" disabled={profileBusy||testingConnection||polishing||tailoring} onClick={()=>void changeProfile(()=>apiClient.createAiProfile({...DEFAULT_BYOK_SETTINGS,providerLabel:'新模型档案'}))} className="rounded border border-teal-300 px-2 py-1">新建模型档案</button>
                    <div className="space-y-1">{catalog.profiles.filter(p=>p.profileId!==catalog.activeProfileId).map(p=><div key={p.profileId} className="flex items-center justify-between gap-1 text-[10px]"><span className="min-w-0 truncate">{p.providerLabel} · {p.model} · {p.hasApiKey?'已存密钥':'无密钥'}</span><button type="button" disabled={profileBusy||testingConnection||polishing||tailoring} onClick={()=>{if(window.confirm('删除该模型档案及其本地加密密钥？'))void changeProfile(()=>apiClient.removeAiProfile(p.profileId!,p.revision!));}} className="text-red-700">删除档案</button></div>)}</div>
                    <p className="text-[10px] text-slate-500">档案独立保存，不自动跨模型切换或复用其他档案密钥。</p>
                   </div>}
                   <input aria-label="模型档案名称" value={aiSettings.providerLabel} onChange={e=>setAiSettings(p=>({...p,providerLabel:e.target.value}))} className="w-full rounded border border-slate-200 p-1.5" placeholder="档案名称"/>
                   <label className="inline-flex cursor-pointer items-center gap-2 font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={aiSettings.enabled}
                      onChange={(e) =>
                        setAiSettings((prev) => ({ ...prev, enabled: e.target.checked }))
                      }
                    />
                    启用 AI 原地润色接口
                  </label>

                  <div className="flex flex-wrap gap-1">
                    {BYOK_PROVIDER_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() =>
                          setAiSettings((prev) => ({
                            ...prev,
                            providerLabel: p.label,
                            baseUrl: p.baseUrl,
                            model: p.defaultModel,
                            deepseekThinking: p.deepseekThinking,
                            apiKey: '',
                            hasApiKey: prev.baseUrl === p.baseUrl && prev.hasApiKey,
                            clearApiKey: false,
                          }))
                        }
                        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-100"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    data-native-undo="true"
                    value={aiSettings.baseUrl}
                    onChange={(e) => setAiSettings((prev) => ({ ...prev, baseUrl: e.target.value, deepseekThinking:undefined, apiKey: '', hasApiKey: false, clearApiKey: false }))}
                    placeholder="OpenAI 兼容 Base URL"
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="password"
                      data-native-undo="true"
                      value={aiSettings.apiKey}
                      onChange={(e) => setAiSettings((prev) => ({ ...prev, apiKey: e.target.value, clearApiKey: false }))}
                      placeholder={aiSettings.hasApiKey && !aiSettings.clearApiKey ? '已保存密钥，留空保留' : 'API Key（Ollama 可留空）'}
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900"
                    />
                    <input
                      type="text"
                      data-native-undo="true"
                      value={aiSettings.model}
                      onChange={(e) => setAiSettings((prev) => ({ ...prev, model: e.target.value, deepseekThinking:supportsDeepSeekThinking(prev.baseUrl,e.target.value)?prev.deepseekThinking:undefined }))}
                      aria-label="模型名"
                      placeholder="模型名（如 deepseek-flash）"
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                  {supportsDeepSeekThinking(aiSettings.baseUrl,aiSettings.model)&&<div className="space-y-1 rounded border border-slate-200 bg-white p-2">
                    <label className="block text-[11px] font-semibold">DeepSeek 思考模式<select aria-label="DeepSeek 思考模式" value={aiSettings.deepseekThinking??'provider-default'} onChange={e=>setAiSettings(p=>({...p,deepseekThinking:e.target.value as ByokAiSettings['deepseekThinking']}))} className="mt-1 w-full rounded border p-1"><option value="disabled">关闭思考 · 短任务优先</option><option value="enabled">开启思考 · 可能更慢</option><option value="provider-default">服务商默认 · 不额外发送参数</option></select></label>
                    <p className="text-[10px] text-slate-500">思考与正文共用输出预算；连接测试只发送固定合成文本（显式关闭时64 tokens，其余最多1024且不超过档案上限）。已有档案不会自动换模型。</p>
                  </div>}
                  {/^deepseek-(chat|reasoner)$/.test(aiSettings.model.trim())&&/^(https:\/\/api\.deepseek\.com)(\/v1)?\/?$/.test(aiSettings.baseUrl.trim())&&<p className="rounded bg-amber-50 p-2 text-[11px] text-amber-900">旧模型名称已不在当前官方推荐列表。可按需手动改为 deepseek-flash 或 deepseek-v4-pro 后保存；不会自动修改现有档案。</p>}
                  {aiSettings.hasApiKey && (
                    <label className="flex items-center gap-2 text-[11px] text-slate-600">
                      <input type="checkbox" checked={Boolean(aiSettings.clearApiKey)}
                        onChange={(e) => setAiSettings(prev => ({ ...prev, clearApiKey: e.target.checked, apiKey: '' }))} />
                      保存时清除已有密钥
                    </label>
                  )}
                  <div className="grid grid-cols-3 gap-1">
                    <label className="text-[10px]">输入字符预算<input aria-label="输入字符预算" type="number" min={1000} max={100000} value={aiSettings.contextBudgetChars??60000} onChange={e=>setAiSettings(p=>({...p,contextBudgetChars:Number(e.target.value)}))} className="w-full rounded border p-1"/></label>
                    <label className="text-[10px]">输出 tokens<input aria-label="输出 tokens" type="number" min={64} max={8192} value={aiSettings.maxOutputTokens??4096} onChange={e=>setAiSettings(p=>({...p,maxOutputTokens:Number(e.target.value)}))} className="w-full rounded border p-1"/></label>
                    <label className="text-[10px]">超时（秒）<input aria-label="超时（秒）" type="number" min={1} max={120} value={(aiSettings.timeoutMs??60000)/1000} onChange={e=>setAiSettings(p=>({...p,timeoutMs:Number(e.target.value)*1000}))} className="w-full rounded border p-1"/></label>
                  </div>
                  <p className="text-[10px] text-slate-500">预算为本地上限，不代表该模型真实上下文能力；不自动重试其他接口。</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-emerald-700">{settingsSavedMsg}</span>
                    <button
                      type="button"
                      onClick={() => void handleSaveAiSettings()}
                       disabled={profileBusy||testingConnection||polishing||tailoring}
                      className="rounded bg-slate-900 px-3 py-1 font-medium text-white hover:bg-slate-800"
                    >
                      保存本地配置
                    </button>
                  </div>
                  <div className="rounded border border-teal-200 bg-white p-2 space-y-1">
                    <p className="text-[10px] text-slate-500">连接测试仅发送固定英文合成探针（无简历、JD 或个人资料），输出上限为64或1024 tokens，并受档案上限约束。</p>
                    <div className="flex items-center gap-2"><button type="button" disabled={profileBusy||testingConnection||polishing||tailoring||!aiSettings.enabled} onClick={()=>void testConnection()} className="rounded border border-teal-300 px-2 py-1 text-teal-800 disabled:opacity-50">测试模型连接</button>{testingConnection&&<button type="button" onClick={()=>testAbort.current?.abort()} className="rounded border px-2 py-1">取消连接测试</button>}</div>
                    {connectionTip&&<p role="status" className="text-emerald-700">{connectionTip}</p>}
                     {connectionAttempt?.settings===aiSettings&&<AiTaskReceiptView label="连接测试调用回执" attempt={connectionAttempt.value}/>}
                  </div>
                </div>
              )}
            </div>

            {/* Mode Switch: Single-Block vs Whole-Resume JD Tailor */}
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px] font-medium">
              <button
                type="button"
                disabled={polishing||tailoring||applying}
                onClick={() => setAiSubMode('single')}
                className={`rounded py-1.5 transition ${
                  aiSubMode === 'single' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                单段精修
              </button>
              <button
                type="button"
                disabled={polishing||tailoring||applying}
                onClick={() => setAiSubMode('tailor')}
                className={`rounded py-1.5 transition ${
                  aiSubMode === 'tailor' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                整卷 JD 改写
              </button>
              <button type="button" disabled={polishing||tailoring||applying} onClick={()=>setAiSubMode('assistant')} className={'rounded py-1.5 '+(aiSubMode==='assistant'?'bg-white text-slate-900 shadow-xs':'text-slate-600 hover:bg-slate-100')}>AI 自由任务</button>
              <button type="button" disabled={polishing||tailoring||applying} onClick={()=>setAiSubMode('layout')} className={'rounded py-1.5 '+(aiSubMode==='layout'?'bg-white text-slate-900 shadow-xs':'text-slate-600 hover:bg-slate-100')}>AI 版式优化</button>
            </div>
            {aiSubMode==='layout'&&<AiLayoutPane document={document} slug={activeSlug} settings={aiSettings} overflowPx={overflowPx} onFlushBeforeApply={onFlushBeforeApply} getCurrentRevision={getCurrentRevision} onImmediateChange={onImmediateChange} assertSettings={assertPreviewSettings}/>} 

            {aiSubMode==='assistant'&&<ResumeAiAssistantPane document={document} slug={activeSlug} settings={aiSettings} jdText={jdText} overflowPx={overflowPx} onFlushBeforeApply={onFlushBeforeApply} getCurrentRevision={getCurrentRevision} onImmediateChange={onImmediateChange} assertSettings={assertPreviewSettings}/>}
            {(aiSubMode==='single'||aiSubMode==='tailor')&&<FactBankPane key={activeSlug+':'+document.id+':'+aiSubMode} document={document} slug={activeSlug} blocks={editableBlocks} keys={factKeys} bank={factBank} selected={factIds} locked={polishing||tailoring||applying||factsBusy||singleReview.busy||wholeReview.busy} onBank={bank=>{setFactBank(bank);setFactIds([]);clearTextApprovals();}} onSelected={ids=>{setFactIds(ids.filter(id=>factBank?.records.some(r=>r.id===id&&isShareableFact(document,r)&&factKeys.includes(r.blockKey))));clearTextApprovals();}} onBusy={setFactsBusy} onFlush={onFlushBeforeApply} getRevision={getCurrentRevision}/>}
            {pendingRequest && (
              <section aria-label="AI 数据发送预览" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-slate-800">
                <div className="font-bold text-amber-900">发送前确认（尚未调用模型）</div>
                <p>接收方：{validateByokBaseUrl(pendingRequest.settings.baseUrl).baseUrl}/chat/completions</p>
                <p>模型：{pendingRequest.settings.model} · 档案：{pendingRequest.settings.providerLabel} · {aiThinkingLabel(pendingRequest.settings)}</p>
                 <p>{describeAiRequest(pendingRequest.settings,pendingRequest.mode==='single'?pendingRequest.options:pendingRequest.prepared.options)}</p>
                <p>下方是本次实际发送的消息内容。基本联系方式、照片和已识别的隐私内容已尽量省略；仍请检查可见经历或 JD 中是否有其他敏感信息。密钥不在预览中。</p>
                {pendingRequest.basis.selection.records.length>0&&<div aria-label="本次外发事实清单" className="max-h-40 overflow-auto rounded border border-amber-200 bg-white p-2 space-y-1"><div className="font-semibold">本次明确外发 {pendingRequest.basis.selection.records.length} 条本人确认事实（证据位置不外发）</div>{Object.values(pendingRequest.mode==='single'?pendingRequest.basis.sourceMap:pendingRequest.prepared.sourceMap).flat().filter(s=>s.scope==='record').map(s=><div key={s.id} className="border-t pt-1"><span className="text-teal-800">{s.id} · 本人确认</span><div className="whitespace-pre-wrap break-words">{s.facts}</div></div>)}</div>}
                <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-amber-200 bg-white p-2">
                  <div className="font-semibold">系统消息</div>
                  <pre className="whitespace-pre-wrap break-words text-[10px]">{(pendingRequest.mode==='single'?pendingRequest.options:pendingRequest.prepared.options).systemPrompt}</pre>
                  <div className="mt-2 font-semibold">用户消息</div>
                  <pre className="whitespace-pre-wrap break-words text-[10px]">{(pendingRequest.mode==='single'?pendingRequest.options:pendingRequest.prepared.options).userPrompt}</pre>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={factsBusy||polishing||tailoring||applying} onClick={confirmPendingRequest} className="rounded bg-teal-700 px-3 py-1.5 font-semibold text-white">确认发送给模型</button>
                  <button type="button" onClick={()=>setPendingRequest(null)} className="rounded border border-slate-300 bg-white px-3 py-1.5">取消发送</button>
                </div>
              </section>
            )}

            {aiSubMode === 'tailor' && (
              <div className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-slate-800">目标岗位招聘 JD（与「JD 雷达」同步）</span>
                  <textarea
                    rows={4}
                    data-native-undo="true"
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                    placeholder="请在此或「JD 雷达」粘贴目标岗位要求，AI 将针对性微调最多 8 个段落并通过 Fact Guard 核查数字/资质边界..."
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 focus:border-teal-500 focus:outline-none"
                  />
                </label>

                <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={tailorUseMasterRef}
                    onChange={(e) => setTailorUseMasterRef(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>可选：仅参考母库中与本段主体及时间相同的可见经历（自述，须人工核实）</span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={tailoring || applying || factsBusy}
                    onClick={() => void handlePrepareTailor()}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-teal-600 py-2 font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                  >
                    <Wand2 size={13} />
                    {tailoring ? '正在分析整卷匹配与防编造检查...' : '生成整卷 JD 定向提案'}
                  </button>
                  {tailoring && (
                    <button
                      type="button"
                      onClick={() => {tailorAbortRef.current?.abort();setWholeAttempt({status:'cancelled'});setTailorError(null);setPendingRequest(null);}}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <XCircle size={13} /> 取消
                    </button>
                  )}
                </div>

                {wholeBasis&&isCurrent(wholeBasis)&&<AiTaskReceiptView label="整卷调用回执" attempt={wholeAttempt}/>}
                {tailorError && (
                  <div role="alert" ref={tailorErrorElement} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                    {tailorError}
                  </div>
                )}
                {tailorNotice && (
                  <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                    {tailorNotice}
                  </div>
                )}

                {tailorProposals.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={applying}
                          onClick={() => {
                            if (window.confirm('机器未报出预警不代表事实属实。确认你已经人工核对这些提案？')) {
                              setTailorProposals(prev=>prev.map(p=>({...p,accepted:p.factWarnings.length===0})));
                            }
                          }}
                          className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50"
                        >
                          已核对后全选无机器预警项
                        </button>
                        <button
                          type="button"
                          disabled={applying}
                          onClick={() =>
                            setTailorProposals((prev) => prev.map((p) => ({ ...p, accepted: false })))
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-100"
                        >
                          清空
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={applying || factsBusy || !tailorProposals.some((p) => p.accepted) || !wholeReview.canApply}
                        onClick={() => void handleApplyTailorProposals()}
                        className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                      >
                        <Check size={12} /> 应用已勾选的 {tailorProposals.filter((p) => p.accepted).length} 条修改
                      </button>
                    </div>

                    <TextPdfReviewGate gate={wholeReview} disabled={applying||!wholeCandidates.length} label="试渲染整卷提案"/>
                    {tailorProposals.map((proposal) => {
                      const linesDiff = computeLineDiff(proposal.originalText, proposal.suggestedText);
                      const isEditing = tailorEditingKey === proposal.blockKey;
                      return (
                        <div
                          key={proposal.id}
                          className={`rounded-xl border p-3 space-y-2 ${
                            proposal.factWarnings.length > 0
                              ? 'border-amber-300 bg-amber-50/40'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <label className="flex cursor-pointer items-center gap-2 font-bold text-slate-900">
                              <input
                                type="checkbox"
                                checked={proposal.accepted}
                                disabled={applying}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setTailorProposals((prev) =>
                                    prev.map((item) =>
                                      item.blockKey === proposal.blockKey
                                        ? { ...item, accepted: checked }
                                        : item,
                                    ),
                                  );
                                }}
                                className="rounded border-slate-300"
                              />
                              <span>{proposal.label}</span>
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                setTailorEditingKey(isEditing ? null : proposal.blockKey)
                              }
                              className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                            >
                              {isEditing ? '收起微调' : '手工微调'}
                            </button>
                          </div>

                          <div className="text-[11px] text-slate-600">{proposal.reason}</div>
                          <div className="rounded border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-600">
                            事实来源（候选人自述，不是独立证明）：
                            {(tailorSources[proposal.blockKey] ?? []).map(source=>(
                              <div key={source.id}>{source.scope==='current'?'当前段落':source.scope==='record'?'本人确认事实':'同源母库'} · {source.label} · {source.id}{proposal.factIds.includes(source.id)?'（模型引用）':''}{source.scope==='record'&&<div className="whitespace-pre-wrap break-words">{source.facts}<div>本地证据：{wholeBasis?.selection.records[Number(source.id.slice(7))-1]?.evidenceRef}</div></div>}</div>
                            ))}
                            <div>请人工核对主体、日期、限定词及因果关系；机器预警无法证明语义真实性。</div>
                          </div>

                          {proposal.matchedJdKeywords.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {proposal.matchedJdKeywords.map((kw) => (
                                <span
                                  key={kw}
                                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                                >
                                  + 命中 {kw}
                                </span>
                              ))}
                            </div>
                          )}

                          {proposal.factWarnings.length > 0 && (
                            <div className="rounded-lg border border-amber-300 bg-amber-100/80 p-2 text-[11px] text-amber-900 space-y-1">
                              <div className="flex items-center gap-1 font-bold">
                                <ShieldAlert size={13} className="text-amber-700" />
                                Fact Guard 防编造预警（确认事实后逐项勾选）
                              </div>
                              {proposal.factWarnings.map((w, idx) => (
                                <div key={idx} className="text-[10px] leading-relaxed">
                                  • {w.message}
                                </div>
                              ))}
                            </div>
                          )}

                          {isEditing ? (
                            <textarea
                              rows={4}
                              data-native-undo="true"
                              value={proposal.suggestedText}
                              disabled={applying}
                              onChange={(e) => {
                                const nextText = e.target.value;
                                const nextWarnings = scanScopedProposalWarnings(nextText, proposal.blockKey, tailorSources, []);
                                setTailorProposals((prev) =>
                                  prev.map((item) =>
                                    item.blockKey === proposal.blockKey
                                      ? { ...item, suggestedText: nextText, factWarnings: nextWarnings, factIds: [], accepted: false }
                                      : item,
                                  ),
                                );
                              }}
                              className="w-full rounded border border-teal-300 bg-white p-2 text-[11px] text-slate-900 focus:outline-none"
                            />
                          ) : (
                            <div className="space-y-0.5 rounded border border-slate-200 bg-white p-2 font-mono text-[10px]">
                              {linesDiff.map((seg, i) => (
                                <div
                                  key={i}
                                  className={
                                    seg.type === 'removed'
                                      ? 'bg-red-50 text-red-700 line-through'
                                      : seg.type === 'added'
                                        ? 'bg-emerald-50 text-emerald-800'
                                        : 'text-slate-500'
                                  }
                                >
                                  {seg.type === 'removed' ? '- ' : seg.type === 'added' ? '+ ' : '  '}
                                  {seg.text}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {aiSubMode === 'single' && (
              <>
            {/* Polish Execution */}
            <div className="space-y-2.5">
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-slate-800">选择要润色的简历段落</span>
                <select
                  value={selectedBlock?.key ?? ''}
                  onChange={(e) => {
                    setSelectedBlockKey(e.target.value);
                    setSuggestedText(null);
                  }}
                  className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900"
                >
                  {editableBlocks.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['star', 'STAR 量化润色'],
                    ['pedagogy', '教研专业化'],
                    ['concise', '精简控字'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPolishMode(id)}
                    className={`rounded border py-1.5 font-medium ${
                      polishMode === id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={polishing || applying || factsBusy || !selectedBlock}
                onClick={handlePreparePolish}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-teal-600 py-2 font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
              >
                <Wand2 size={13} /> {polishing ? '请求模型生成中...' : '生成润色对比 Diff'}
              </button>

              {polishing&&<button type="button" onClick={()=>{polishAbortRef.current?.abort();setSingleAttempt({status:'cancelled'});setPolishError(null);}} className="rounded border px-2 py-1">取消单段请求</button>}
              {singleBasis&&isCurrent(singleBasis)&&<AiTaskReceiptView label="单段调用回执" attempt={singleAttempt}/>}
              {polishError && (
                <div role="alert" ref={polishErrorElement} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  {polishError}
                </div>
              )}
            </div>

            {/* Side-by-side / Line-by-line Diff Review */}
            {suggestedText !== null && selectedBlock && (
              <div className="space-y-2.5 rounded-xl border border-teal-300 bg-teal-50/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-teal-900">原文 vs 建议 Diff 审阅</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSuggestedText(null)}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                    >
                      放弃
                    </button>
                    <button
                      type="button"
                      disabled={applying || factsBusy || !polishRiskConfirmed || !singleReview.canApply}
                      onClick={() => void handleAdoptDiff()}
                      className="inline-flex items-center gap-1 rounded bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-500"
                    >
                      <Check size={12} /> 采纳替换（可 Ctrl+Z）
                    </button>
                  </div>
                </div>

                <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                  <div>来源：当前所选段落（候选人自述）。数字检查不等于事实或语义验证，请核对主体、角色、时间及否定限定。</div>
                  {singleBasis?.selection.records.map((r,i)=><div key={r.id} className="rounded border border-amber-200 p-1 break-words">提供给模型的事实 record-{i+1}：{r.assertion}<div>本地证据：{r.evidenceRef}（纯正文输出不代表模型逐条引用）</div></div>)}
                  {polishWarnings.map((warning, i) => <div key={i}>{warning.message}</div>)}
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={polishRiskConfirmed} disabled={applying}
                      onChange={(e) => setPolishRiskConfirmed(e.target.checked)} />
                    我已核对以上事实，确认属实
                  </label>
                </div>
                <TextPdfReviewGate gate={singleReview} disabled={applying||!polishRiskConfirmed} label="试渲染单段提案"/>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded border border-slate-200 bg-white p-2">
                    <div className="mb-1 text-[10px] font-bold text-slate-500">当前原文</div>
                    <div className="whitespace-pre-wrap text-[11px] text-slate-700">{selectedBlock.text}</div>
                  </div>
                  <div className="rounded border border-emerald-200 bg-emerald-50/60 p-2">
                    <div className="mb-1 text-[10px] font-bold text-emerald-700">AI 建议版</div>
                    <div className="whitespace-pre-wrap text-[11px] text-slate-900">{suggestedText}</div>
                  </div>
                </div>

                <div className="space-y-0.5 rounded border border-slate-200 bg-white p-2 font-mono text-[10px]">
                  {diffSegments.map((seg, i) => (
                    <div
                      key={i}
                      className={
                        seg.type === 'removed'
                          ? 'bg-red-50 text-red-700 line-through'
                          : seg.type === 'added'
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'text-slate-500'
                      }
                    >
                      {seg.type === 'removed' ? '- ' : seg.type === 'added' ? '+ ' : '  '}
                      {seg.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
