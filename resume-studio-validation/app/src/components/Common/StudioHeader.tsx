import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Command,
  FileCode2,
  FileDown,
  FileImage,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  Redo2,
  ShieldAlert,
  Shrink,
  Undo2,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import type { ResumeSummary } from '../../schema/resumeSchema';
import type { ExportFormat } from '../../hooks/useResumeExport';
import type { StudioNavTab } from './CommandPaletteModal';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface StudioHeaderProps {
  activeSlug: string;
  activeTab: StudioNavTab;
  summaries: ResumeSummary[];
  masterSummary: ResumeSummary | null;
  saveState: SaveState;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  isRedacted: boolean;
  isRedactionPopoverOpen: boolean;
  redactionTermsInput: string;
  isFitting: boolean;
  isExporting: boolean;
  isExportMenuOpen: boolean;
  desktop: boolean;
  onSwitchVersion: (slug: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onManualSave: () => void;
  onBackToEdit: () => void;
  onToggleRedacted: () => void;
  onSetRedacted: (value: boolean) => void;
  onToggleRedactionPopover: () => void;
  onCloseRedactionPopover: () => void;
  onRedactionTermsChange: (value: string) => void;
  onFitOnePage: () => void;
  onToggleExportMenu: () => void;
  onExportFormat: (format: ExportFormat, saveAs?: boolean) => void;
  onOpenCommandPalette: () => void;
}

export function StudioHeader({
  activeSlug,
  activeTab,
  summaries,
  masterSummary,
  saveState,
  saveError,
  canUndo,
  canRedo,
  undoCount,
  redoCount,
  isRedacted,
  isRedactionPopoverOpen,
  redactionTermsInput,
  isFitting,
  isExporting,
  isExportMenuOpen,
  desktop,
  onSwitchVersion,
  onUndo,
  onRedo,
  onManualSave,
  onBackToEdit,
  onToggleRedacted,
  onSetRedacted,
  onToggleRedactionPopover,
  onCloseRedactionPopover,
  onRedactionTermsChange,
  onFitOnePage,
  onToggleExportMenu,
  onExportFormat,
  onOpenCommandPalette,
}: StudioHeaderProps) {
  return (
    <header aria-label="工作台顶栏" className="no-print flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-800 bg-[#11161f] px-3 py-1.5 text-slate-100 2xl:flex-nowrap">
      <div aria-label="版本与保存状态" className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 2xl:flex-1 2xl:flex-nowrap">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold tracking-tight text-white">
          <HardDrive size={15} className="text-teal-400" />
          Resume Studio
        </span>
        <span className="h-4 w-px bg-slate-700" />

        <select
          aria-label="快速切换简历版本"
          value={activeSlug}
          onChange={(e) => onSwitchVersion(e.target.value)}
          className="min-w-[88px] max-w-[min(220px,35vw)] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-100 focus:border-teal-500 focus:outline-none"
        >
          {summaries.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.title}
            </option>
          ))}
          {masterSummary && <option value="master">母库：{masterSummary.title}</option>}
        </select>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label="撤销"
            title={`撤销 (Ctrl+Z)${undoCount > 0 ? ` · 可撤 ${undoCount} 步` : ''}`}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-35"
          >
            <Undo2 size={12} />
            {undoCount > 0 && <span className="font-mono text-[10px] text-slate-400">{undoCount}</span>}
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            aria-label="重做"
            title={`重做 (Ctrl+Y)${redoCount > 0 ? ` · 可恢复 ${redoCount} 步` : ''}`}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-35"
          >
            <Redo2 size={12} />
            {redoCount > 0 && <span className="font-mono text-[10px] text-slate-400">{redoCount}</span>}
          </button>
        </div>

        <div role="status" aria-label="本地保存状态" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs">
          {saveState === 'saving' && (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Loader2 size={12} className="animate-spin" /> 正在落盘...
            </span>
          )}
          {saveState === 'dirty' && <span className="text-amber-400">待自动保存...</span>}
          {saveState === 'saved' && (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 size={12} /> 已保存至本地硬盘
            </span>
          )}
          {saveState === 'error' && (
            <span className="inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap text-red-400" title={saveError ?? undefined}>
              <AlertCircle size={12} /> 保存失败
              <button
                type="button"
                onClick={onManualSave}
                className="shrink-0 whitespace-nowrap rounded border border-red-400/40 bg-red-950/60 px-1.5 py-0.5 text-[10px] font-medium text-red-200 hover:bg-red-900"
              >
                重试保存
              </button>
            </span>
          )}
        </div>
      </div>

      <div aria-label="工作台操作" className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-nowrap 2xl:shrink-0 2xl:flex-nowrap">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="打开命令面板"
          title="全局命令面板 (Ctrl+K)"
          className="inline-flex items-center gap-1.5 rounded border border-slate-700/80 bg-slate-900/90 px-2 py-1 text-[11px] text-slate-300 hover:border-teal-500/50 hover:text-white"
        >
          <Command size={11} className="text-teal-400" />
          <span>快捷搜索</span>
          <kbd className="hidden rounded bg-slate-800 px-1 font-mono text-[10px] text-slate-400 xl:inline">Ctrl+K</kbd>
        </button>

        {activeTab === 'templates' && (
          <button
            type="button"
            onClick={onBackToEdit}
            className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            返回画布预览
          </button>
        )}

        {activeTab !== 'templates' && (
          <>
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={onToggleRedacted}
                aria-pressed={isRedacted}
                title="开启隐私脱敏预览与导出模式（姓名/手机/邮箱/照片与敏感词自动打码，不改原档）"
                className={`inline-flex items-center gap-1 rounded-l border px-2.5 py-1 text-xs font-medium transition ${
                  isRedacted
                    ? 'border-purple-400 bg-purple-600 text-white'
                    : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                <ShieldAlert size={13} />
                {isRedacted ? '脱敏模式中' : '隐私脱敏'}
              </button>
              <button
                type="button"
                aria-label="设置自定义脱敏敏感词"
                onClick={onToggleRedactionPopover}
                className={`inline-flex items-center rounded-r border border-l-0 px-1.5 py-1 text-xs transition ${
                  isRedacted
                    ? 'border-purple-400 bg-purple-700 text-white hover:bg-purple-600'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <ChevronDown size={12} />
              </button>

              {isRedactionPopoverOpen && (
                <div className="absolute top-full left-0 z-50 mt-1.5 w-64 rounded-lg border border-slate-700 bg-[#19202c] p-3 text-xs text-slate-100 shadow-2xl">
                  <div className="font-semibold text-white">自定义脱敏敏感词</div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    自动打码姓名/手机/邮箱并隐藏证件照；下方填写需替换为{' '}
                    <code className="font-mono">[某单位]</code> 的学校或公司（逗号/换行分隔）：
                  </p>
                  <textarea
                    rows={3}
                    data-native-undo="true"
                    value={redactionTermsInput}
                    onChange={(e) => onRedactionTermsChange(e.target.value)}
                    placeholder="例如：示例大学, 示例研究院"
                    className="mt-2 w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-purple-400 focus:outline-none"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={isRedacted}
                        onChange={(e) => onSetRedacted(e.target.checked)}
                      />
                      <span>立即启用脱敏预览</span>
                    </label>
                    <button
                      type="button"
                      onClick={onCloseRedactionPopover}
                      className="rounded bg-slate-700 px-2.5 py-1 text-[11px] hover:bg-slate-600"
                    >
                      完成
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={isFitting}
              onClick={onFitOnePage}
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              <Shrink size={13} />
              {isFitting ? '压缩中...' : '一键压回一页'}
            </button>
          </>
        )}

        <div className="relative flex items-center">
          <button
            type="button"
            disabled={isExporting}
            onClick={() => onExportFormat('pdf', false)}
            className="inline-flex items-center gap-1.5 rounded-l bg-teal-600 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-teal-500 disabled:opacity-50"
          >
            {isExporting ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
            {isExporting ? '导出中...' : '导出 PDF'}
          </button>
          <button
            type="button"
            disabled={isExporting}
            aria-label="更多导出格式"
            aria-expanded={isExportMenuOpen}
            onClick={onToggleExportMenu}
            className="inline-flex items-center gap-1 rounded-r border-l border-teal-700 bg-teal-600 px-2 py-1 text-xs font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            <span>更多格式</span>
            <ChevronDown size={12} />
          </button>

          {isExportMenuOpen && (
            <div
              role="menu"
              className="absolute top-full right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-lg border border-slate-700 bg-[#19202c] py-1 text-xs text-slate-100 shadow-2xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => onExportFormat('png', false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800"
              >
                <FileImage size={13} className="text-sky-400" /> 高清 2x PNG 长图
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onExportFormat('docx', false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800"
              >
                <FileText size={13} className="text-blue-400" /> Word 可编辑 (.docx)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onExportFormat('markdown', false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800"
              >
                <FileCode2 size={13} className="text-amber-400" /> Markdown (.md)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onExportFormat('html', false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800"
              >
                <FileCode2 size={13} className="text-emerald-400" /> 单文件网页主页 (.html)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onExportFormat('jsonResume', false)}
                className="flex w-full items-center gap-2 border-t border-slate-800 px-3 py-2 text-left hover:bg-slate-800"
              >
                <FileDown size={13} className="text-indigo-400" /> 标准 JSON Resume（仅可见内容）
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onExportFormat('json', false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800"
              >
                <FileDown size={13} className="text-slate-400" /> 本地 JSON 备份（含隐藏内容）
              </button>
            </div>
          )}
        </div>

        {desktop && (
          <>
            <button
              type="button"
              disabled={isExporting}
              onClick={() => onExportFormat('pdf', true)}
              className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              另存为...
            </button>
            <button
              type="button"
              onClick={() => void apiClient.openExportsDir()}
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              <FolderOpen size={12} /> 打开导出目录
            </button>
          </>
        )}
      </div>
    </header>
  );
}
