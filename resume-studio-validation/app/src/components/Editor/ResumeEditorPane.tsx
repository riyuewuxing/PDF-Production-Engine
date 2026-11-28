import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { buttonSkin, iconSkin } from '../../studio-theme/componentSkins';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  SeparatorHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { applyCjkSpacingToDocument } from '../../lib/cjkSpacing';
import { useHandleDragReorder } from '../../lib/dragReorder';
import {
  MenuSection,
  ResumeDocument,
  normalizeSectionsOrder,
} from '../../schema/resumeSchema';
import {
  LucideIconByName,
  SECTION_ICON_OPTIONS,
  resolveSectionIconName,
} from '../../templates/shared';
import { BasicInfoEditor } from './BasicInfoEditor';
import { SectionItemsEditor } from './SectionItemsEditor';

interface ResumeEditorPaneProps {
  document: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  onImmediateChange?: (next: ResumeDocument) => void;
  focusSectionRequest?: { id: string; seq: number } | null;
}

export function ResumeEditorPane({
  document,
  onChange,
  onImmediateChange,
  focusSectionRequest,
}: ResumeEditorPaneProps) {
  const skins=useStudioComponentSkins();
  const [openSectionIds, setOpenSectionIds] = useState<Record<string, boolean>>({
    basic: true,
    education: true,
  });
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [iconPickerSectionId, setIconPickerSectionId] = useState<string | null>(null);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionIcon, setNewSectionIcon] = useState('FileText');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!focusSectionRequest) return;
    const targetId = focusSectionRequest.id;
    setOpenSectionIds((prev) => ({ ...prev, [targetId]: true }));
    setHighlightedId(targetId);
    const scrollTimer = setTimeout(() => {
      sectionRefs.current[targetId]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }, 40);
    const clearTimer = setTimeout(() => {
      setHighlightedId((curr) => (curr === targetId ? null : curr));
    }, 1400);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [focusSectionRequest]);

  const orderedSections = [...document.menuSections].sort((a, b) => a.order - b.order);
  const emitDiscrete = onImmediateChange ?? onChange;

  const updateSections = (nextSections: MenuSection[]) => {
    emitDiscrete({
      ...document,
      menuSections: normalizeSectionsOrder(nextSections),
    });
  };

  const sectionDnd = useHandleDragReorder(
    orderedSections,
    (reordered) => updateSections(reordered),
    (idx) => orderedSections[idx]?.id !== 'basic',
  );

  const moveSection = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= orderedSections.length) return;
    const copy = [...orderedSections];
    const current = copy[index];
    const neighbor = copy[target];
    if (!current || !neighbor) return;
    copy[index] = neighbor;
    copy[target] = current;
    updateSections(copy.map((s, idx) => ({ ...s, order: idx })));
  };

  const startRename = (sec: MenuSection) => {
    setRenamingId(sec.id);
    setRenameDraft(sec.title);
  };

  const commitRename = (id: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      updateSections(
        orderedSections.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
      );
    }
    setRenamingId(null);
  };

  const deleteSection = (sectionId: string) => {
    if (sectionId === 'basic') return;
    const nextSections = orderedSections.filter((s) => s.id !== sectionId);
    const nextCustomData = { ...document.customData };
    delete nextCustomData[sectionId];
    emitDiscrete({
      ...document,
      menuSections: normalizeSectionsOrder(nextSections),
      customData: nextCustomData,
    });
  };

  const addExperienceSection = () => {
    if (orderedSections.some((s) => s.id === 'experience')) return;
    const nextSection: MenuSection = {
      id: 'experience',
      title: '工作经历',
      icon: 'Briefcase',
      enabled: true,
      order: orderedSections.length,
      pageBreakBefore: false,
    };
    emitDiscrete({
      ...document,
      menuSections: normalizeSectionsOrder([...orderedSections, nextSection]),
    });
    setOpenSectionIds((prev) => ({ ...prev, experience: true }));
  };

  const addCustomSection = () => {
    const title = newSectionTitle.trim() || '自定义模块';
    const id = `custom-${crypto.randomUUID()}`;
    const nextSection: MenuSection = {
      id,
      title,
      icon: newSectionIcon || 'FileText',
      enabled: true,
      order: orderedSections.length,
      pageBreakBefore: false,
    };
    emitDiscrete({
      ...document,
      menuSections: normalizeSectionsOrder([...orderedSections, nextSection]),
      customData: {
        ...document.customData,
        [id]: [
          {
            id: crypto.randomUUID(),
            title: '',
            subtitle: '',
            dateRange: '',
            description: '',
            visible: true,
          },
        ],
      },
    });
    setNewSectionTitle('');
    setNewSectionIcon('FileText');
    setOpenSectionIds((prev) => ({ ...prev, [id]: true }));
  };

  const toggleOpen = (id: string) => {
    setOpenSectionIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const hasExperienceModule = orderedSections.some((s) => s.id === 'experience');

  return (
    <div className="flex h-full flex-col bg-white studio-ui-surface">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 studio-ui-border px-4 py-2.5">
        <div>
          <div className="text-xs font-bold text-slate-900 studio-ui-primary">内容编辑</div>
          <div className="text-[11px] text-slate-500 studio-ui-muted">拖动抓手排模块 · 点击右侧可跳转定位</div>
        </div>
        <button data-studio-control="true"
          type="button"
          onClick={() => emitDiscrete(applyCjkSpacingToDocument(document))}
          title="在中英文与数字间自动补充半角空格（跳过邮箱、URL、日期及不等式），支持 Ctrl+Z 撤销"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-teal-200 studio-ui-selected-border bg-teal-50 studio-ui-selected px-2 py-1 text-[11px] font-medium text-teal-800 studio-ui-selected-text hover:bg-teal-100 studio-ui-selected-hover"
        >
          <Sparkles size={11} /> 一键中英排版
        </button>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5">
        {!orderedSections.some(s => s.id === 'basic') && (
          <div className="rounded-lg border border-amber-200 studio-ui-warning-border bg-amber-50 studio-ui-warning-surface p-3 text-xs text-slate-700 studio-ui-primary">
            <p className="mb-2">导入文档未包含基本信息模块，原有字段仍保留。恢复后只显示已启用的字段。</p>
            <button data-studio-control="true" type="button" className="rounded border border-amber-300 studio-ui-warning-border bg-white studio-ui-surface px-2 py-1 font-medium hover:bg-amber-100 studio-ui-warning-hover"
              onClick={() => {
                updateSections([{id:'basic',title:'基本信息',icon:'User',enabled:true,order:0,pageBreakBefore:false},
                  ...orderedSections.map((s,index)=>({...s,order:index+1}))]);
                setOpenSectionIds(prev=>({...prev,basic:true}));
              }}>
              恢复基本信息模块
            </button>
          </div>
        )}
        {orderedSections.map((section, index) => {
          const isOpen = !!openSectionIds[section.id];
          const isBasic = section.id === 'basic';
          const isHighlighted = highlightedId === section.id;
          const isDragTarget = sectionDnd.overIndex === index && sectionDnd.draggingIndex !== index;
          const isDragging = sectionDnd.draggingIndex === index;
          const activeIconName = resolveSectionIconName(section);
          const isPickerOpen = iconPickerSectionId === section.id;

          return (
            <div
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              {...(!isBasic ? sectionDnd.getContainerProps(index) : {})}
              className={`rounded-lg border transition-all ${
                isHighlighted
                  ? 'border-amber-500 studio-ui-warning-border ring-2 ring-amber-400/50 studio-ui-warning-ring'
                  : isDragTarget
                    ? 'border-t-2 border-t-sky-500 studio-ui-info-top-border border-sky-400 studio-ui-info-border bg-sky-50/40 studio-ui-info-surface'
                    : isDragging
                      ? 'border-slate-300 studio-ui-border bg-slate-100 studio-ui-raised opacity-60'
                      : section.enabled
                        ? 'border-slate-200 studio-ui-border bg-white studio-ui-surface'
                        : 'border-slate-200/70 studio-ui-border bg-slate-50/80 studio-ui-raised'
              }`}
            >
              <div className="relative flex items-center justify-between gap-1.5 px-2.5 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {!isBasic && (
                    <span
                      {...sectionDnd.getHandleProps(index)}
                      title="按住拖动重排模块"
                      aria-label={`拖拽调整${section.title}顺序`}
                      className="cursor-grab active:cursor-grabbing rounded p-0.5 text-slate-400 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-700 studio-ui-hover-primary"
                    >
                      <GripVertical size={14} />
                    </span>
                  )}

                  {!isBasic && (
                    <button data-studio-control="true"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIconPickerSectionId((curr) => (curr === section.id ? null : section.id));
                      }}
                      aria-label={`更换${section.title}图标`}
                      title="点击更换模块图标"
                      className={`shrink-0 rounded p-1 transition ${
                        isPickerOpen
                          ? 'bg-teal-100 studio-ui-selected text-teal-800 studio-ui-selected-text'
                          : 'text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-900 studio-ui-hover-primary'
                      }`}
                    >
                      <LucideIconByName name={activeIconName} size={13} />
                    </button>
                  )}

                  <button data-studio-control="true"
                    type="button"
                    onClick={() => toggleOpen(section.id)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? '折叠' : '展开'}${section.title}`}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown size={15} className="shrink-0 text-slate-500 studio-ui-muted" />
                    ) : (
                      <ChevronRight size={15} className="shrink-0 text-slate-500 studio-ui-muted" />
                    )}
                    {renamingId === section.id ? (
                      <input data-studio-control="true"
                        type="text"
                        autoFocus
                        value={renameDraft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => commitRename(section.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(section.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="w-full rounded border border-slate-400 studio-ui-border bg-white studio-ui-surface px-1.5 py-0.5 text-sm font-semibold text-slate-900 studio-ui-primary focus:outline-none"
                      />
                    ) : (
                      <span
                        className={`truncate text-sm font-semibold ${
                          section.enabled ? 'text-slate-900 studio-ui-primary' : 'text-slate-400 studio-ui-muted line-through'
                        }`}
                      >
                        {section.title}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button data-studio-control="true"
                    type="button"
                    {...iconSkin(skins)}
                    onClick={() => startRename(section)}
                    aria-label={`重命名${section.title}`}
                    title="重命名模块"
                    className="rounded p-1 text-slate-400 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-700 studio-ui-hover-primary"
                  >
                    <Pencil size={13} />
                  </button>
                  {!isBasic && (
                    <button data-studio-control="true"
                      type="button"
                      onClick={() =>
                        updateSections(
                          orderedSections.map((s) =>
                            s.id === section.id
                              ? { ...s, pageBreakBefore: !s.pageBreakBefore }
                              : s,
                          ),
                        )
                      }
                      aria-label={`模块前换页 ${section.title}`}
                      title={
                        section.pageBreakBefore
                          ? '已设置：从新页开始（点击取消）'
                          : '在此模块前手动插入分页符'
                      }
                      className={`rounded p-1 transition ${
                        section.pageBreakBefore
                          ? 'bg-sky-100 studio-ui-info-surface text-sky-700 studio-ui-info'
                          : 'text-slate-400 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-700 studio-ui-hover-primary'
                      }`}
                    >
                      <SeparatorHorizontal size={13} />
                    </button>
                  )}
                  {(!isBasic || !section.enabled) && (
                    <button data-studio-control="true"
                      type="button"
                      onClick={() =>
                        updateSections(
                          orderedSections.map((s) =>
                            s.id === section.id ? { ...s, enabled: !s.enabled } : s,
                          ),
                        )
                      }
                      aria-label={section.enabled ? `隐藏模块${section.title}` : `显示模块${section.title}`}
                      title={section.enabled ? '模块已启用' : '模块已隐藏'}
                      className="rounded p-1 text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover"
                    >
                      {section.enabled ? (
                        <Eye size={14} />
                      ) : (
                        <EyeOff size={14} className="text-amber-600 studio-ui-warning" />
                      )}
                    </button>
                  )}
                  <button data-studio-control="true"
                    type="button"
                    disabled={index === 0 || (index === 1 && orderedSections[0]?.id === 'basic')}
                    {...iconSkin(skins)}
                    onClick={() => moveSection(index, -1)}
                    aria-label={`上移${section.title}`}
                    className="rounded p-1 text-slate-400 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-700 studio-ui-hover-primary disabled:opacity-25"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button data-studio-control="true"
                    type="button"
                    disabled={index === orderedSections.length - 1 || isBasic}
                    {...iconSkin(skins)}
                    onClick={() => moveSection(index, 1)}
                    aria-label={`下移${section.title}`}
                    className="rounded p-1 text-slate-400 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-700 studio-ui-hover-primary disabled:opacity-25"
                  >
                    <ArrowDown size={13} />
                  </button>
                  {!isBasic && (
                    <button data-studio-control="true"
                      type="button"
                      {...iconSkin(skins,'danger')}
                    onClick={() => deleteSection(section.id)}
                      aria-label={`删除模块${section.title}`}
                      title="删除模块"
                      className="rounded p-1 text-slate-400 studio-ui-muted hover:bg-red-50 studio-ui-error-hover hover:text-red-600 studio-ui-error-hover-text"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {isPickerOpen && (
                  <div
                    role="listbox"
                    aria-label={`${section.title}图标选择器`}
                    className="absolute top-full left-8 z-30 mt-1 grid grid-cols-4 gap-1 rounded-lg border border-slate-200 studio-ui-border bg-white studio-ui-surface p-2 shadow-xl"
                  >
                    {SECTION_ICON_OPTIONS.map((opt) => {
                      const selected = activeIconName === opt.name;
                      return (
                        <button data-studio-control="true"
                          key={opt.name}
                          type="button"
                          title={opt.label}
                          aria-label={`选择图标 ${opt.label}`}
                          onClick={() => {
                            updateSections(
                              orderedSections.map((s) =>
                                s.id === section.id ? { ...s, icon: opt.name } : s,
                              ),
                            );
                            setIconPickerSectionId(null);
                          }}
                          className={`flex items-center justify-center rounded p-1.5 transition ${
                            selected
                              ? 'bg-teal-600 studio-ui-fill text-white studio-ui-on-fill'
                              : 'text-slate-600 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-900 studio-ui-hover-primary'
                          }`}
                        >
                          <LucideIconByName name={opt.name} size={14} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="border-t border-slate-100 studio-ui-divider p-3">
                  {isBasic ? (
                    <BasicInfoEditor
                      basic={document.basic}
                      onChange={(nextBasic) => onChange({ ...document, basic: nextBasic })}
                      onImmediateChange={(nextBasic) => emitDiscrete({ ...document, basic: nextBasic })}
                    />
                  ) : (
                    <SectionItemsEditor
                      document={document}
                      section={section}
                      onChange={onChange}
                      onImmediateChange={emitDiscrete}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div className="rounded-lg border border-dashed border-slate-300 studio-ui-border bg-slate-50/70 studio-ui-raised p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-700 studio-ui-primary">模块管理</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select data-studio-control="true"
              aria-label="新模块图标"
              value={newSectionIcon}
              onChange={(e) => setNewSectionIcon(e.target.value)}
              className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-xs text-slate-700 studio-ui-primary focus:border-slate-500 studio-ui-focus-border focus:outline-none"
            >
              {SECTION_ICON_OPTIONS.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.label}
                </option>
              ))}
            </select>
            <input data-studio-control="true"
              type="text"
              value={newSectionTitle}
              onChange={(e) => setNewSectionTitle(e.target.value)}
              placeholder="新模块名称（如：社团和组织经历）"
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCustomSection();
              }}
              className="min-w-0 flex-1 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2.5 py-1.5 text-xs text-slate-900 studio-ui-primary focus:border-slate-500 studio-ui-focus-border focus:outline-none"
            />
            <button data-studio-control="true"
              type="button"
              {...buttonSkin(skins,'primary')}
                    onClick={addCustomSection}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-900 studio-ui-fill px-2.5 py-1.5 text-xs font-medium text-white studio-ui-on-fill hover:bg-slate-800 studio-ui-fill-hover"
            >
              <Plus size={13} /> 添加模块
            </button>
          </div>
          {!hasExperienceModule && (
            <button data-studio-control="true"
              type="button"
              {...buttonSkin(skins)}
                    onClick={addExperienceSection}
              className="inline-flex w-full items-center justify-center gap-1 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface py-1.5 text-xs font-medium text-slate-700 studio-ui-primary hover:bg-slate-100 studio-ui-hover"
            >
              <Plus size={13} /> 启用标准“工作经历”模块
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
