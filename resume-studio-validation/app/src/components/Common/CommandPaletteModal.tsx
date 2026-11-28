import {
  Command,
  FileDown,
  LayoutGrid,
  Palette,
  PenLine,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ResumeSummary, TemplateId } from '../../schema/resumeSchema';
import { TEMPLATE_REGISTRY } from '../../templates/registry';
import { STUDIO_THEME_IDS, STUDIO_THEMES, type StudioThemeId } from '../../studio-theme/presets';
import {useStudioThemeId} from '../../studio-theme/StudioThemeProvider';
import {surfaceStyle} from '../../studio-theme/surfaces';

export type StudioNavTab = 'edit' | 'templates' | 'style' | 'versions' | 'diagnose' | 'career';

export interface CommandPaletteItem {
  id: string;
  category: '面板导航' | '快捷操作' | '简历版本' | '模板切换';
  title: string;
  subtitle: string;
  keywords: string;
  onSelect: () => void;
}

interface CommandPaletteModalProps {
  activeStudioTheme?: StudioThemeId;
  onSelectStudioTheme?: (id: StudioThemeId) => void;
  isOpen: boolean;
  onClose: () => void;
  activeTab: StudioNavTab;
  activeSlug: string;
  activeTemplateId: TemplateId;
  activeLocale: 'zh-CN' | 'en-US';
  isRedacted: boolean;
  summaries: ResumeSummary[];
  masterSummary: ResumeSummary | null;
  onSelectTab: (tab: StudioNavTab) => void;
  onSwitchVersion: (slug: string) => void;
  onSelectTemplate: (templateId: TemplateId, recommendedColor?: string) => void;
  onExportFormat: (
    format: 'pdf' | 'png' | 'docx' | 'markdown' | 'html' | 'json' | 'jsonResume',
  ) => void;
  onFitOnePage: () => void;
  onToggleRedacted: () => void;
  onToggleLocale: () => void;
}

export function CommandPaletteModal({
  activeStudioTheme,
  onSelectStudioTheme,
  isOpen,
  onClose,
  activeTab,
  activeSlug,
  activeTemplateId,
  activeLocale,
  isRedacted,
  summaries,
  masterSummary,
  onSelectTab,
  onSwitchVersion,
  onSelectTemplate,
  onExportFormat,
  onFitOnePage,
  onToggleRedacted,
  onToggleLocale,
}: CommandPaletteModalProps) {
  const contextThemeId=useStudioThemeId();
  const themeId=activeStudioTheme??contextThemeId;
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dialogRef=useRef<HTMLDivElement>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const onCloseRef=useRef(onClose);
  onCloseRef.current=onClose;
  useLayoutEffect(()=>{
    const dialog=dialogRef.current;
    if(!isOpen||!dialog)return;
    // Capture the opener before focusing search. No focus theft after an action navigates away.
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const focusSearch=()=> (searchRef.current??dialog).focus({preventScroll:true});
    focusSearch();
    const onKey=(e:KeyboardEvent)=>{
      if(e.isComposing||e.keyCode===229)return;
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey){
        const key=e.key.toLowerCase();
        if(key==='k'||key==='s'){
          e.preventDefault();e.stopPropagation();
          if(key==='k')onCloseRef.current();
          return;
        }
      }
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onCloseRef.current();return;}
      if(e.key!=='Tab')return;
      const items=Array.from(dialog.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')).filter(el=>el.tabIndex>=0&&el.getClientRects().length>0);
      const index=items.indexOf(document.activeElement as HTMLElement);
      if(!items.length){e.preventDefault();dialog.focus({preventScroll:true});return;}
      // Native traversal inside the list preserves scroll-to-focused-option.
      if(index<0||(e.shiftKey?index===0:index===items.length-1)){
        e.preventDefault();e.stopPropagation();
        (e.shiftKey?items[items.length-1]:items[0])?.focus();
      }
    };
    const onFocus=(e:FocusEvent)=>{if(e.target instanceof Node&&!dialog.contains(e.target))focusSearch();};
    document.addEventListener('keydown',onKey,true);
    document.addEventListener('focusin',onFocus);
    return()=>{
      document.removeEventListener('keydown',onKey,true);
      document.removeEventListener('focusin',onFocus);
      const active=document.activeElement;
      if(opener?.isConnected&&!opener.closest('[inert]')&&(!active||active===document.body||dialog.contains(active)))opener.focus({preventScroll:true});
    };
  },[isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHighlightedIdx(0);
    }
  }, [isOpen]);

  const allItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: 'tab-edit',
        category: '面板导航',
        title: '切换到「内容编辑」',
        subtitle: activeTab === 'edit' ? '当前所在面板' : '左侧表单与富文本经历编辑',
        keywords: 'edit editor 内容编辑 经历 教育',
        onSelect: () => onSelectTab('edit'),
      },
      {
        id: 'tab-templates',
        category: '面板导航',
        title: `打开「模板库 (${TEMPLATE_REGISTRY.length})」`,
        subtitle: '浏览全部商业/大厂/学术模板缩略图',
        keywords: 'templates gallery 模板库 换肤',
        onSelect: () => onSelectTab('templates'),
      },
      {
        id: 'tab-style',
        category: '面板导航',
        title: '切换到「样式底色」',
        subtitle: '配色、字体、字号、中英文混排、语言切换',
        keywords: 'style font color 样式底色 字体 配色',
        onSelect: () => onSelectTab('style'),
      },
      {
        id: 'tab-versions',
        category: '面板导航',
        title: '切换到「版本母库」',
        subtitle: '管理岗位子版本、母库合并、快照时间机器',
        keywords: 'versions master snapshot 版本母库 快照',
        onSelect: () => onSelectTab('versions'),
      },
      {
        id: 'tab-diagnose',
        category: '面板导航',
        title: '切换到「诊断优化」',
        subtitle: 'HR 体检、JD 匹配、ATS 逆向体检、AI 整卷 Tailor',
        keywords: 'diagnose ats jd ai tailor 诊断优化 体检',
        onSelect: () => onSelectTab('diagnose'),
      },
      {
        id: 'tab-career',
        category: '面板导航',
        title: '切换到「求职面试」',
        subtitle: '投递追踪漏斗、自荐信 PDF、BOSS 开场白、面试提纲',
        keywords: 'career interview cover letter 求职面试 自荐信 投递',
        onSelect: () => onSelectTab('career'),
      },
      {
        id: 'action-export-pdf',
        category: '快捷操作',
        title: '导出矢量 A4 PDF',
        subtitle: isRedacted ? '当前处于脱敏模式，将输出 -脱敏版.pdf' : '原生矢量文字可全选复制',
        keywords: 'export pdf 导出 打印',
        onSelect: () => onExportFormat('pdf'),
      },
      {
        id: 'action-export-html',
        category: '快捷操作',
        title: '导出单文件离线网页主页 (.html)',
        subtitle: '零外网 CDN 依赖，内嵌证件照 DataURL 与明暗切换',
        keywords: 'export html web homepage 离线网页 主页',
        onSelect: () => onExportFormat('html'),
      },
      {
        id: 'action-export-docx',
        category: '快捷操作',
        title: '导出可编辑 Word (.docx)',
        subtitle: '适配考编/国企/高校标准提交格式',
        keywords: 'export docx word 导出',
        onSelect: () => onExportFormat('docx'),
      },
      {
        id: 'action-export-png',
        category: '快捷操作',
        title: '导出高清 2x PNG 长图',
        subtitle: '适合微信/BOSS直聘快速预览转发',
        keywords: 'export png image 图片 导出',
        onSelect: () => onExportFormat('png'),
      },
      {
        id: 'action-export-json-resume',
        category: '快捷操作',
        title: '导出标准 JSON Resume (.json)',
        subtitle: '开源通用 JSON Resume 生态双向互通格式',
        keywords: 'export jsonresume json resume 标准',
        onSelect: () => onExportFormat('jsonResume'),
      },
      {
        id: 'action-fit-one-page',
        category: '快捷操作',
        title: '一键压回一页（智能收敛排版）',
        subtitle: '自动微调字号/行高/页边距，支持 1 步 Ctrl+Z 撤销',
        keywords: 'fit one page 一键压回一页 压缩',
        onSelect: () => onFitOnePage(),
      },
      {
        id: 'action-toggle-redacted',
        category: '快捷操作',
        title: isRedacted ? '关闭隐私脱敏模式' : '开启隐私脱敏预览与导出',
        subtitle: '自动打码姓名、手机、邮箱、照片与自定义敏感词',
        keywords: 'redact privacy 隐私脱敏 打码',
        onSelect: () => onToggleRedacted(),
      },
      {
        id: 'action-toggle-locale',
        category: '快捷操作',
        title: activeLocale === 'zh-CN' ? '切换简历语言为 English (en-US)' : '切换简历语言为 中文 (zh-CN)',
        subtitle: '自动转换标准栏目标签与英文标点间距设置',
        keywords: 'locale language english chinese 切换语言 英文 中文',
        onSelect: () => onToggleLocale(),
      },
    ];

    if (onSelectStudioTheme) {
      for (const id of STUDIO_THEME_IDS) {
        items.push({
          id: 'studio-theme-' + id,
          category: '快捷操作',
          title: '工作台外观预览：' + STUDIO_THEMES[id].label,
          subtitle: (activeStudioTheme === id ? '当前选择 · ' : '') + '编辑、样式、模板、版本主面板、HR/ATS及外框；不改变简历',
          keywords: 'studio theme appearance 工作台主题 外观 皮肤 ' + id,
          onSelect: () => onSelectStudioTheme(id),
        });
      }
    }

    for (const s of summaries) {
      items.push({
        id: `version-${s.slug}`,
        category: '简历版本',
        title: `切换版本：${s.title}`,
        subtitle: `${s.slug}${s.slug === activeSlug ? ' · 当前已打开' : ''}`,
        keywords: `version switch 版本 ${s.slug} ${s.title}`,
        onSelect: () => onSwitchVersion(s.slug),
      });
    }
    if (masterSummary) {
      items.push({
        id: 'version-master',
        category: '简历版本',
        title: `切换母库：${masterSummary.title}`,
        subtitle: `master${activeSlug === 'master' ? ' · 当前已打开' : ''}`,
        keywords: `version master 母库 ${masterSummary.title}`,
        onSelect: () => onSwitchVersion('master'),
      });
    }

    for (const tpl of TEMPLATE_REGISTRY) {
      items.push({
        id: `tpl-${tpl.id}`,
        category: '模板切换',
        title: `模板：${tpl.name}`,
        subtitle: `${tpl.id}${tpl.id === activeTemplateId ? ' · 当前使用中' : ''} — ${tpl.subtitle}`,
        keywords: `template 模板 ${tpl.id} ${tpl.name} ${tpl.category} ${tpl.tags.join(' ')}`,
        onSelect: () => onSelectTemplate(tpl.id, tpl.recommendedColor),
      });
    }

    return items;
  }, [
    activeStudioTheme,
    onSelectStudioTheme,
    activeLocale,
    activeSlug,
    activeTab,
    activeTemplateId,
    isRedacted,
    masterSummary,
    onExportFormat,
    onFitOnePage,
    onSelectTab,
    onSelectTemplate,
    onSwitchVersion,
    onToggleLocale,
    onToggleRedacted,
    summaries,
  ]);

  const filteredItems = useMemo(() => {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return allItems.slice(0, 36);
    return allItems.filter((item) => {
      const haystack = `${item.category} ${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    });
  }, [allItems, query]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${highlightedIdx}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIdx]);

  if (!isOpen) return null;

  const safeIndex = filteredItems.length === 0 ? -1 : Math.min(highlightedIdx, filteredItems.length - 1);

  const handleRunItem = (item: CommandPaletteItem) => {
    item.onSelect();
    onClose();
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 px-4 pt-16 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef} tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="全局命令面板"
        data-studio-region="command-palette" data-studio-surface="panel" data-studio-theme={themeId} style={surfaceStyle(themeId,'panel')}
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#151c28] text-slate-100 shadow-2xl studio-ui-border"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-slate-800 px-4 py-3 studio-ui-border">
          <Search size={16} className="shrink-0 text-teal-400 studio-ui-info" />
          <input data-studio-control="true"
            type="text"
            ref={searchRef}
            data-native-undo="true"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredItems.length > 0) {
                  setHighlightedIdx((prev) => (prev + 1) % filteredItems.length);
                }
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (filteredItems.length > 0) {
                  setHighlightedIdx((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
                }
                return;
              }
              if (e.key === 'Enter') {
                // Guard against Chinese/Japanese IME composition Enter
                const nativeIsComposing =
                  typeof e.nativeEvent === 'object' && e.nativeEvent !== null && e.nativeEvent.isComposing;
                const reactIsComposing = Boolean(
                  (e as unknown as { isComposing?: boolean }).isComposing,
                );
                if (nativeIsComposing || reactIsComposing) return;
                if (safeIndex >= 0 && filteredItems[safeIndex]) {
                  e.preventDefault();
                  handleRunItem(filteredItems[safeIndex]!);
                }
              }
            }}
            placeholder="输入关键字搜索面板、版本、51 套模板或快捷操作（支持空格分词）..."
            aria-label="搜索命令、模板与版本"
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none studio-ui-primary"
          />
          <button data-studio-control="true"
            type="button"
            onClick={onClose}
            aria-label="关闭命令面板"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white studio-ui-muted studio-ui-hover studio-ui-hover-primary"
          >
            <X size={15} />
          </button>
        </div>

        <div ref={listRef} className="min-h-0 max-h-[420px] overflow-y-auto p-2">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400 studio-ui-muted">
              未找到匹配「{query}」的命令、模板或版本。
            </div>
          ) : (
            <ul role="listbox" aria-label="匹配命令列表" className="space-y-1">
              {filteredItems.map((item, idx) => {
                const isSelected = idx === safeIndex;
                const CategoryIcon =
                  item.category === '面板导航'
                    ? PenLine
                    : item.category === '模板切换'
                      ? LayoutGrid
                      : item.category === '简历版本'
                        ? Palette
                        : item.id.includes('export')
                          ? FileDown
                          : Sparkles;
                return (
                  <li key={item.id}>
                    <button data-studio-control="true"
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-cmd-index={idx}
                      onMouseEnter={() => setHighlightedIdx(idx)}
                      onClick={() => handleRunItem(item)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${
                        isSelected
                          ? 'bg-teal-600/25 text-white ring-1 ring-teal-500/50 studio-ui-selected studio-ui-ring studio-ui-selected-text'
                          : 'text-slate-200 hover:bg-slate-800/70 studio-ui-primary studio-ui-hover'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CategoryIcon
                          size={14}
                          className={isSelected ? 'shrink-0 text-teal-300 studio-ui-selected-text' : 'shrink-0 text-slate-400 studio-ui-muted'}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium">{item.title}</div>
                          <div className="truncate text-[11px] text-slate-400 studio-ui-muted">{item.subtitle}</div>
                        </div>
                      </div>
                      <span className="shrink-0 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-slate-400 studio-ui-border studio-ui-raised studio-ui-muted">
                        {item.category}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-slate-800 bg-[#101620] px-4 py-2 text-[11px] text-slate-400 studio-ui-border studio-ui-raised studio-ui-muted">
          <span className="inline-flex items-center gap-1.5">
            <Command size={11} className="text-teal-400 studio-ui-info" />
            <span>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
          </span>
          <span>共 {filteredItems.length} 项匹配</span>
        </div>
      </div>
    </div>
  );
}
