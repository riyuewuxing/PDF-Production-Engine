import { buttonSkin } from '../../studio-theme/componentSkins';
import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import {
  BookmarkCheck,
  CheckCircle2,
  Columns2,
  FileText,
  FolderOpen,
  Moon,
  ScrollText,
  ShieldAlert,
  Sun,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiClient, isDesktopMode } from '../../lib/apiClient';
import { DENSITY_LIMITS } from '../../lib/pageFit';
import type { StudioThemeId } from '../../studio-theme/presets';
import { resolvePreviewBacking, stageStyle, surfaceStyle, type PreviewBacking } from '../../studio-theme/surfaces';
import type { GlobalSettings, ResumeDocument } from '../../schema/resumeSchema';
import { getTemplateMetadata } from '../../templates/registry';
import {
  InteractiveSection,
  PreviewInteractionContext,
  SectionBody,
  SectionHeading,
  getOrderedVisibleSections,
  getSheetRootStyle,
} from '../../templates/shared';

interface A4PreviewPaneProps {
  studioThemeId?: StudioThemeId;
  document: ResumeDocument;
  highlightedSectionId?: string | null;
  onSelectSection: (sectionId: string) => void;
  onUpdateSettings: (next: GlobalSettings) => void;
  measureRef: React.MutableRefObject<(() => number) | null>;
  onOverflowChange?: (px: number) => void;
  fitFeedback: { type: 'ok' | 'warn'; text: string } | null;
  exportStatus: { type: 'ok' | 'warn' | 'error'; text: string; filePath?: string } | null;
  canLogApplication?: boolean;
  onOpenQuickLog?: () => void;
  isRedacted?: boolean;
  onDisableRedaction?: () => void;
}

export function A4PreviewPane({
  studioThemeId = 'classic',
  document,
  highlightedSectionId,
  onSelectSection,
  onUpdateSettings,
  measureRef,
  onOverflowChange,
  fitFeedback,
  exportStatus,
  canLogApplication = false,
  onOpenQuickLog,
  isRedacted = false,
  onDisableRedaction,
}: A4PreviewPaneProps) {
  const skins=useStudioComponentSkins();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const [zoomMode, setZoomMode] = useState<'auto' | '0.75' | '0.9' | '1'>('auto');
  const [autoScale, setAutoScale] = useState(0.85);
  const [overflowPx, setOverflowPx] = useState(0);
  const [sheetHeightPx, setSheetHeightPx] = useState(1123);
  const [canvasTheme, setCanvasTheme] = useState<PreviewBacking>('follow');
  const [layoutView, setLayoutView] = useState<'scroll' | 'spread'>('scroll');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateScale = () => {
      const available = el.clientWidth - 64;
      const computed = Math.min(1, Math.max(0.45, available / 794));
      setAutoScale(Math.round(computed * 100) / 100);
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    measureRef.current = () => {
      const contentEl = contentRef.current;
      const rulerEl = rulerRef.current;
      if (!contentEl || !rulerEl) return 0;
      return Math.round(contentEl.offsetHeight - rulerEl.offsetHeight);
    };
  }, [measureRef]);

  useLayoutEffect(() => {
    const contentEl = contentRef.current;
    const rulerEl = rulerRef.current;
    if (!contentEl || !rulerEl) return;

    const recalc = () => {
      const ov = Math.round(contentEl.offsetHeight - rulerEl.offsetHeight);
      setOverflowPx(ov);
      onOverflowChange?.(ov);
      setSheetHeightPx(Math.max(contentEl.offsetHeight, rulerEl.offsetHeight));
    };
    recalc();

    const ro = new ResizeObserver(recalc);
    ro.observe(contentEl);
    ro.observe(rulerEl);
    return () => ro.disconnect();
  // Scroll/spread replaces the measured DOM nodes; rebind the observer to the new refs.
  }, [document, onOverflowChange, layoutView]);

  const scale = zoomMode === 'auto' ? autoScale : Number(zoomMode);
  const spreadScale = Math.max(0.36, Math.min(0.65, Math.round(scale * 0.62 * 100) / 100));
  const { globalSettings } = document;
  const templateMeta = getTemplateMetadata(document.templateId);
  const TemplateComponent = templateMeta.component;
  const isOverflow = overflowPx > 2;
  const isDarkSheet = document.templateId === 'vip-cyber-dark';
  const sheetBgColor = isDarkSheet ? '#0b1220' : globalSettings.paperBackground || '#ffffff';

  const visibleSections = getOrderedVisibleSections(document);
  const firstManualBreakIndex = visibleSections.findIndex((s, idx) => idx > 0 && s.pageBreakBefore);
  const manualBreakCount = visibleSections.filter((s, idx) => idx > 0 && s.pageBreakBefore).length;
  const hasManualBreak = manualBreakCount > 0;
  const estimatedPages = Math.max(
    1 + manualBreakCount,
    isOverflow ? Math.ceil(sheetHeightPx / 1122) : 1,
  );
  const isMultiPage = isOverflow || hasManualBreak;

  const isSpread = layoutView === 'spread';
  const desktop = isDesktopMode();
  const backing = resolvePreviewBacking(studioThemeId, canvasTheme);
  const isDark = backing.scheme === 'dark';
  const previewStyle = surfaceStyle(studioThemeId, 'preview');

  const patchSetting = <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) => {
    onUpdateSettings({ ...globalSettings, [key]: value });
  };

  return (
    <section
      data-studio-stage={studioThemeId !== 'classic' ? 'themed' : undefined}
      data-studio-preview-backing={canvasTheme}
      style={stageStyle(backing)}
      className={`print-workspace flex min-w-0 flex-1 flex-col transition-colors ${
        isDark ? 'bg-[#181d27]' : 'bg-slate-200/80'
      }`}
    >
      {/* Compact Canvas Micro-Toolbar */}
      <div data-studio-surface="preview" data-studio-theme={studioThemeId} style={previewStyle}
        className={`no-print flex flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5 text-xs ${
          isDark
            ? 'border-slate-800 studio-ui-border bg-[#1e2533] text-slate-300 studio-ui-muted'
            : 'border-slate-200 studio-ui-border bg-white studio-ui-surface text-slate-700 studio-ui-primary'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3.5">
          <label className="flex items-center gap-1.5">
            <span className="opacity-70">字号</span>
            <input data-studio-control="true"
              type="range"
              aria-label="基础字号"
              min={DENSITY_LIMITS.baseFontSize.min}
              max={DENSITY_LIMITS.baseFontSize.max}
              step={DENSITY_LIMITS.baseFontSize.step}
              value={globalSettings.baseFontSize}
              onChange={(e) => patchSetting('baseFontSize', Number(e.target.value))}
              className="w-16 accent-teal-500 studio-ui-accent"
            />
            <span className="w-8 font-mono text-[11px]">{globalSettings.baseFontSize}</span>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="opacity-70">行高</span>
            <input data-studio-control="true"
              type="range"
              aria-label="行高"
              min={DENSITY_LIMITS.lineHeight.min}
              max={DENSITY_LIMITS.lineHeight.max}
              step={DENSITY_LIMITS.lineHeight.step}
              value={globalSettings.lineHeight}
              onChange={(e) => patchSetting('lineHeight', Number(e.target.value))}
              className="w-16 accent-teal-500 studio-ui-accent"
            />
            <span className="w-7 font-mono text-[11px]">{globalSettings.lineHeight.toFixed(2)}</span>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="opacity-70">模块距</span>
            <input data-studio-control="true"
              type="range"
              aria-label="模块间距"
              min={DENSITY_LIMITS.sectionSpacing.min}
              max={DENSITY_LIMITS.sectionSpacing.max}
              step={DENSITY_LIMITS.sectionSpacing.step}
              value={globalSettings.sectionSpacing}
              onChange={(e) => patchSetting('sectionSpacing', Number(e.target.value))}
              className="w-16 accent-teal-500 studio-ui-accent"
            />
            <span className="w-6 font-mono text-[11px]">{globalSettings.sectionSpacing}</span>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="opacity-70">页边距</span>
            <input data-studio-control="true"
              type="range"
              aria-label="页边距"
              min={DENSITY_LIMITS.pagePadding.min}
              max={DENSITY_LIMITS.pagePadding.max}
              step={DENSITY_LIMITS.pagePadding.step}
              value={globalSettings.pagePadding}
              onChange={(e) => patchSetting('pagePadding', Number(e.target.value))}
              className="w-16 accent-teal-500 studio-ui-accent"
            />
            <span className="w-6 font-mono text-[11px]">{globalSettings.pagePadding}</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span
            aria-label="预估页数"
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
              estimatedPages > 2
                ? 'bg-amber-500/20 studio-ui-warning-surface text-amber-300 studio-ui-warning ring-1 ring-amber-400/40 studio-ui-warning-ring'
                : 'bg-slate-700/60 studio-ui-raised text-slate-200 studio-ui-primary ring-1 ring-slate-600 studio-ui-ring'
            }`}
          >
            共 {estimatedPages} 页
          </span>

          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              isOverflow
                ? 'bg-red-500/15 studio-ui-error-surface text-red-400 studio-ui-error ring-1 ring-red-500/40 studio-ui-error-ring'
                : 'bg-emerald-500/15 studio-ui-success-surface text-emerald-400 studio-ui-success ring-1 ring-emerald-500/40 studio-ui-success-ring'
            }`}
          >
            {isOverflow ? `超出单页 +${overflowPx}px` : `单页内 (余 ${Math.max(0, -overflowPx)}px)`}
          </span>

          <select data-studio-control="true"
            aria-label="画布缩放"
            value={zoomMode}
            onChange={(e) => setZoomMode(e.target.value as typeof zoomMode)}
            className={`rounded border px-2 py-0.5 text-[11px] ${
              isDark
                ? 'border-slate-700 studio-ui-border bg-slate-800 studio-ui-raised text-slate-200 studio-ui-primary'
                : 'border-slate-300 studio-ui-border bg-white studio-ui-surface text-slate-800 studio-ui-primary'
            }`}
          >
            <option value="auto">适应窗口 ({Math.round(autoScale * 100)}%)</option>
            <option value="0.75">75%</option>
            <option value="0.9">90%</option>
            <option value="1">100%</option>
          </select>

          <button data-studio-control="true"
            type="button"
            onClick={() => setLayoutView((v) => (v === 'scroll' ? 'spread' : 'scroll'))}
            aria-label={isSpread ? '切回单列滚动' : '双页并排总览'}
            title={isSpread ? '切回单列滚动' : '双页并排总览'}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${
              isSpread
                ? 'border-teal-500 studio-ui-selected-border bg-teal-600/20 studio-ui-selected text-teal-300 studio-ui-selected-text'
                : isDark
                  ? 'border-slate-700 studio-ui-border bg-slate-800 studio-ui-raised text-slate-200 studio-ui-primary hover:bg-slate-700 studio-ui-hover'
                  : 'border-slate-300 studio-ui-border bg-white studio-ui-surface text-slate-700 studio-ui-primary hover:bg-slate-50 studio-ui-hover'
            }`}
          >
            {isSpread ? <ScrollText size={12} /> : <Columns2 size={12} />}
            {isSpread ? '单列滚动' : '双页总览'}
          </button>

          <button {...buttonSkin(skins)} data-studio-control="true"
            type="button"
            onClick={() => setCanvasTheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? '切换浅色画布' : '切换暗色画布'}
            title={isDark ? '切换浅色画布' : '切换暗色画布'}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${
              isDark
                ? 'border-slate-700 studio-ui-border bg-slate-800 studio-ui-raised text-slate-200 studio-ui-primary hover:bg-slate-700 studio-ui-hover'
                : 'border-slate-300 studio-ui-border bg-white studio-ui-surface text-slate-700 studio-ui-primary hover:bg-slate-50 studio-ui-hover'
            }`}
          >
            {isDark ? <Sun size={12} /> : <Moon size={12} />}
            {isDark ? '浅色底' : '暗调底'}
          </button>
          {canvasTheme !== 'follow' && (
            <button {...buttonSkin(skins)} data-studio-control="true" type="button" aria-label="画布底衬跟随工作台"
              onClick={() => setCanvasTheme('follow')}
              className="rounded border border-slate-300 studio-ui-border px-2 py-0.5 text-[11px] text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover">
              跟随工作台
            </button>
          )}
        </div>
      </div>

      {/* Feedback & Redaction Banners */}
      {(isRedacted || fitFeedback || exportStatus) && (
        <div data-studio-surface="preview" data-studio-theme={studioThemeId} style={previewStyle} className="no-print space-y-1 border-b border-slate-800/40 studio-ui-border bg-[#181d27] px-4 py-2">
          {isRedacted && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-purple-400/50 studio-ui-privacy-border bg-purple-600/20 studio-ui-privacy-surface px-3 py-1.5 text-xs text-purple-100 studio-ui-privacy"
            >
              <span className="inline-flex items-center gap-1.5 font-medium">
                <ShieldAlert size={14} className="shrink-0 text-purple-300 studio-ui-privacy" />
                当前处于隐私脱敏预览与导出模式（已掩码姓名/手机/邮箱/敏感词并隐藏照片，不改动磁盘原档）
              </span>
              {onDisableRedaction && (
                <button {...buttonSkin(skins)} data-studio-control="true"
                  type="button"
                  onClick={onDisableRedaction}
                  className="rounded border border-purple-300/40 studio-ui-privacy-border bg-purple-950/60 studio-ui-privacy-surface px-2 py-0.5 text-[11px] font-medium text-purple-100 studio-ui-privacy hover:bg-purple-900 studio-ui-privacy-hover"
                >
                  退出脱敏模式
                </button>
              )}
            </div>
          )}

          {fitFeedback && (
            <div
              role="status"
              className={`rounded px-3 py-1.5 text-xs ${
                fitFeedback.type === 'ok'
                  ? 'border border-emerald-500/30 studio-ui-success-border bg-emerald-500/15 studio-ui-success-surface text-emerald-200 studio-ui-success'
                  : 'border border-amber-500/30 studio-ui-warning-border bg-amber-500/15 studio-ui-warning-surface text-amber-200 studio-ui-warning'
              }`}
            >
              {fitFeedback.text}
            </div>
          )}

          {exportStatus && (
            <div
              role="status"
              className={`flex flex-wrap items-center justify-between gap-2 rounded px-3 py-1.5 text-xs ${
                exportStatus.type === 'ok'
                  ? 'border border-emerald-500/30 studio-ui-success-border bg-emerald-500/15 studio-ui-success-surface text-emerald-200 studio-ui-success'
                  : exportStatus.type==='warn'
                    ? 'border border-amber-500/40 studio-ui-warning-border bg-amber-500/15 studio-ui-warning-surface text-amber-200 studio-ui-warning'
                    : 'border border-red-500/40 studio-ui-error-border bg-red-500/15 studio-ui-error-surface text-red-200 studio-ui-error'
              }`}
            >
              <span className="inline-flex items-center gap-1.5 break-all">
                {exportStatus.type === 'ok' && <CheckCircle2 size={14} className="shrink-0 text-emerald-400 studio-ui-success" />}
                {exportStatus.text}
              </span>
              {exportStatus.type !== 'error' && (canLogApplication || (exportStatus.filePath && desktop)) && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {canLogApplication && onOpenQuickLog && (
                    <button {...buttonSkin(skins,'primary')} data-studio-control="true"
                      type="button"
                      onClick={onOpenQuickLog}
                      className="inline-flex items-center gap-1 rounded border border-teal-300/60 studio-ui-selected-border bg-teal-600 studio-ui-fill px-2.5 py-0.5 font-semibold text-white studio-ui-on-fill hover:bg-teal-500 studio-ui-fill-hover"
                    >
                      <BookmarkCheck size={12} /> 记入投递并锁定快照
                    </button>
                  )}
                  {exportStatus.filePath && desktop && (
                    <>
                      <button {...buttonSkin(skins)} data-studio-control="true"
                        type="button"
                        onClick={() => void apiClient.openFile(exportStatus.filePath!)}
                        className="inline-flex items-center gap-1 rounded border border-emerald-400/40 studio-ui-success-border bg-emerald-950/60 studio-ui-success-surface px-2 py-0.5 font-medium text-emerald-200 studio-ui-success hover:bg-emerald-900 studio-ui-success-hover"
                      >
                        <FileText size={12} /> 打开文件
                      </button>
                      <button {...buttonSkin(skins)} data-studio-control="true"
                        type="button"
                        onClick={() => void apiClient.showInFolder(exportStatus.filePath!)}
                        className="inline-flex items-center gap-1 rounded border border-emerald-400/40 studio-ui-success-border bg-emerald-950/60 studio-ui-success-surface px-2 py-0.5 font-medium text-emerald-200 studio-ui-success hover:bg-emerald-900 studio-ui-success-hover"
                      >
                        <FolderOpen size={12} /> 打开所在文件夹
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scrollable / Side-by-Side A4 Sheet Viewport */}
      <div ref={containerRef} className="print-workspace flex-1 overflow-auto p-6">
        {isSpread ? (
          <div className="mx-auto flex flex-col items-center gap-4">
            <div className="flex flex-wrap items-start justify-center gap-6">
              {/* Page 1 Frame */}
              <div className="flex flex-col items-center gap-1.5">
                <span data-studio-stage-label="true" className="no-print text-[11px] font-medium text-slate-400">第 1 页</span>
                <div
                  className="overflow-hidden rounded-xs shadow-2xl ring-1 ring-black/25"
                  style={{
                    width: `calc(210mm * ${spreadScale})`,
                    height: `calc(297mm * ${spreadScale})`,
                    backgroundColor: sheetBgColor,
                  }}
                >
                  <div
                    className="origin-top-left"
                    style={{
                      width: '210mm',
                      transform: `scale(${spreadScale})`,
                    }}
                  >
                    <div className="a4-sheet relative" style={{ backgroundColor: sheetBgColor }}>
                      <div
                        ref={rulerRef}
                        aria-hidden="true"
                        className="no-print pointer-events-none absolute top-0 left-0 w-px opacity-0"
                        style={{ height: '297mm' }}
                      />
                      <div ref={contentRef}>
                        <PreviewInteractionContext.Provider
                          value={{ highlightedSectionId, onSelectSection }}
                        >
                          <TemplateComponent document={document} />
                        </PreviewInteractionContext.Provider>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Page 2 Frame */}
              <div className="no-print flex flex-col items-center gap-1.5">
                <span data-studio-stage-label="true" className="text-[11px] font-medium text-slate-400">
                  第 2 页
                  {isOverflow
                    ? '（自然续页）'
                    : hasManualBreak
                      ? '（手动分页续页）'
                      : '（当前在单页内）'}
                </span>
                <div
                  className="relative overflow-hidden rounded-xs shadow-2xl ring-1 ring-black/25"
                  style={{
                    width: `calc(210mm * ${spreadScale})`,
                    height: `calc(297mm * ${spreadScale})`,
                    backgroundColor: sheetBgColor,
                  }}
                >
                  {isOverflow ? (
                    <div
                      className="origin-top-left"
                      style={{
                        width: '210mm',
                        transform: `scale(${spreadScale})`,
                      }}
                    >
                      <div
                        className="a4-sheet"
                        style={{
                          backgroundColor: sheetBgColor,
                          transform: 'translateY(-297mm)',
                        }}
                      >
                        <PreviewInteractionContext.Provider
                          value={{ highlightedSectionId, onSelectSection }}
                        >
                          <TemplateComponent document={document} />
                        </PreviewInteractionContext.Provider>
                      </div>
                    </div>
                  ) : hasManualBreak && firstManualBreakIndex > 0 ? (
                    <div
                      className="origin-top-left"
                      style={{
                        width: '210mm',
                        transform: `scale(${spreadScale})`,
                      }}
                    >
                      <div
                        className={`a4-sheet ${isDarkSheet ? 'text-slate-100' : 'text-slate-900'}`}
                        style={getSheetRootStyle(globalSettings, {
                          backgroundColor: sheetBgColor,
                          padding: `${globalSettings.pagePadding}px`,
                          minHeight: '297mm',
                        })}
                      >
                        <div className="mb-3 rounded border border-sky-400/40 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-400">
                          手动分页续页预览 · 导出 PDF 时从「{visibleSections[firstManualBreakIndex]?.title}」起新页
                        </div>
                        {visibleSections.slice(firstManualBreakIndex).map((section, idx, arr) => (
                          <InteractiveSection
                            key={section.id}
                            sectionId={section.id}
                            title={section.title}
                            style={{
                              marginBottom:
                                idx === arr.length - 1 ? 0 : `${globalSettings.sectionSpacing}px`,
                            }}
                          >
                            <SectionHeading
                              section={section}
                              globalSettings={globalSettings}
                              accent={globalSettings.themeColor || '#167883'}
                              darkMode={isDarkSheet}
                            />
                            <SectionBody
                              doc={document}
                              section={section}
                              options={{
                                accentColor: isDarkSheet ? '#38bdf8' : globalSettings.themeColor || '#167883',
                                darkMode: isDarkSheet,
                              }}
                            />
                          </InteractiveSection>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`flex h-full items-center justify-center p-6 text-center text-xs ${
                        isDarkSheet ? 'text-slate-400' : 'text-slate-400'
                      }`}
                    >
                      {isMultiPage
                        ? '请导出 PDF 查看精确分页视图。'
                        : '简历完整容纳于第 1 页内，无需翻页。'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {estimatedPages > 2 && (
              <div data-studio-region="preview-spread-warning" data-studio-surface="preview" data-studio-theme={studioThemeId} data-studio-status="warning" style={previewStyle} className="no-print rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-200">
                提示：当前简历预估共 {estimatedPages} 页（双页总览仅展示第 1–2 页）。建议精简条目或点击顶部「一键压回一页」。
              </div>
            )}
          </div>
        ) : (
          <div
            className="print-scale-container mx-auto origin-top"
            style={{
              width: `calc(210mm * ${scale})`,
              height: `${Math.ceil(sheetHeightPx * scale)}px`,
            }}
          >
            <div
              className="print-scale-container origin-top-left"
              style={{
                width: '210mm',
                transform: `scale(${scale})`,
              }}
            >
              <div
                className="a4-sheet relative shadow-2xl ring-1 ring-black/25"
                style={{ backgroundColor: sheetBgColor }}
              >
                <div
                  ref={rulerRef}
                  aria-hidden="true"
                  className="no-print pointer-events-none absolute top-0 left-0 w-px opacity-0"
                  style={{ height: '297mm' }}
                />

                {globalSettings.showPageGuide && (
                  <div
                    aria-hidden="true"
                    className={`no-print pointer-events-none absolute right-0 left-0 z-20 border-t-2 border-dashed ${
                      isOverflow ? 'border-red-500' : 'border-slate-300/50'
                    }`}
                    style={{ top: '297mm' }}
                  >
                    <span
                      className={`absolute right-2 -top-3 rounded px-1.5 py-0.5 text-[10px] font-medium shadow-xs ${
                        isOverflow
                          ? 'bg-red-600 text-white'
                          : 'border border-slate-200 bg-slate-100 text-slate-500'
                      }`}
                    >
                      {isOverflow
                        ? `297mm 单页警戒线 · 超出 +${overflowPx}px`
                        : '297mm 单页底线'}
                    </span>
                  </div>
                )}

                <div ref={contentRef}>
                  <PreviewInteractionContext.Provider
                    value={{
                      highlightedSectionId,
                      onSelectSection,
                    }}
                  >
                    <TemplateComponent document={document} />
                  </PreviewInteractionContext.Provider>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Slim Bottom Status */}
      <div data-studio-surface="preview" data-studio-theme={studioThemeId} style={previewStyle}
        className={`no-print flex items-center justify-between border-t px-4 py-1 text-[11px] ${
          isDark
            ? 'border-slate-800 studio-ui-border bg-[#11161f] text-slate-400 studio-ui-muted'
            : 'border-slate-200 studio-ui-border bg-white studio-ui-surface text-slate-500 studio-ui-muted'
        }`}
      >
        <span>当前模板：{templateMeta.name}（A4 210mm × 297mm · 预估 {estimatedPages} 页）</span>
        <span>点击画布任意模块可直达左侧编辑 · 按 Ctrl+S 立即保存 · 按 F11 切换全屏</span>
      </div>
    </section>
  );
}
