import {
  ArrowDown,
  ArrowUp,
  Bold,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  List,
  Plus,
  Trash2,
} from 'lucide-react';
import React, { useRef } from 'react';
import { useHandleDragReorder } from '../../lib/dragReorder';
import type {
  CustomItem,
  EducationItem,
  ExperienceItem,
  MenuSection,
  ProjectItem,
  ResumeDocument,
} from '../../schema/resumeSchema';

interface SectionItemsEditorProps {
  document: ResumeDocument;
  section: MenuSection;
  onChange: (next: ResumeDocument) => void;
  onImmediateChange?: (next: ResumeDocument) => void;
}

function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const copy = [...list];
  const current = copy[index];
  const neighbor = copy[target];
  if (current === undefined || neighbor === undefined) return list;
  copy[index] = neighbor;
  copy[target] = current;
  return copy;
}

function MarkdownTextarea({
  value,
  onChangeValue,
  rows = 3,
  placeholder,
  className = '',
}: {
  value: string;
  onChangeValue: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const insertBullet = () => {
    const el = ref.current;
    if (!el) {
      onChangeValue(value ? `${value.trimEnd()}\n- ` : '- ');
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before.length === 0 || before.endsWith('\n') ? '- ' : '\n- ';
    const next = `${before}${prefix}${after}`;
    onChangeValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + prefix.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const wrapBold = () => {
    const el = ref.current;
    if (!el) {
      onChangeValue(`${value}**重点**`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || '重点内容';
    const next = `${value.slice(0, start)}**${selected}**${value.slice(end)}`;
    onChangeValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 2, start + 2 + selected.length);
    });
  };

  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button data-studio-control="true"
            type="button"
            onClick={insertBullet}
            className="inline-flex items-center gap-1 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-1.5 py-0.5 text-[11px] text-slate-700 studio-ui-primary hover:bg-slate-100 studio-ui-hover"
          >
            <List size={11} /> 添加列表项
          </button>
          <button data-studio-control="true"
            type="button"
            onClick={wrapBold}
            className="inline-flex items-center gap-1 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 studio-ui-primary hover:bg-slate-100 studio-ui-hover"
          >
            <Bold size={11} /> 加粗选中
          </button>
        </div>
        <span className="text-[10px] text-slate-400 studio-ui-muted">支持 - 列表与 **加粗**</span>
      </div>
      <textarea data-studio-control="true"
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface p-2 text-xs leading-relaxed text-slate-900 studio-ui-primary focus:border-slate-500 studio-ui-focus-border focus:outline-none"
      />
    </div>
  );
}

function ItemToolbar({
  title,
  visible,
  index,
  total,
  dragHandleProps,
  onToggleVisible,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  title: string;
  visible: boolean;
  index: number;
  total: number;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
  onToggleVisible: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 studio-ui-divider pb-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {dragHandleProps && (
          <span
            {...dragHandleProps}
            title="按住拖曳调整顺序"
            aria-label="按住拖曳调整顺序"
            className="cursor-grab active:cursor-grabbing rounded p-0.5 text-slate-400 studio-ui-muted hover:bg-slate-200 studio-ui-hover hover:text-slate-700 studio-ui-hover-primary"
          >
            <GripVertical size={13} />
          </span>
        )}
        <span className={`truncate text-xs font-semibold ${visible ? 'text-slate-800 studio-ui-primary' : 'text-slate-400 studio-ui-muted line-through'}`}>
          {title || '未命名条目'}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button data-studio-control="true"
          type="button"
          onClick={onDuplicate}
          aria-label="复制一份该条经历"
          title="复制一份插入下方"
          className="rounded p-1 text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-800 studio-ui-hover-primary"
        >
          <Copy size={13} />
        </button>
        <button data-studio-control="true"
          type="button"
          onClick={onToggleVisible}
          aria-label={visible ? '隐藏该条经历' : '显示该条经历'}
          title={visible ? '点击隐藏该条经历' : '点击显示该条经历'}
          className="rounded p-1 text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-800 studio-ui-hover-primary"
        >
          {visible ? <Eye size={14} /> : <EyeOff size={14} className="text-amber-600 studio-ui-warning" />}
        </button>
        <button data-studio-control="true"
          type="button"
          disabled={index === 0}
          onClick={onMoveUp}
          aria-label="上移条目"
          className="rounded p-1 text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover disabled:opacity-30"
        >
          <ArrowUp size={13} />
        </button>
        <button data-studio-control="true"
          type="button"
          disabled={index === total - 1}
          onClick={onMoveDown}
          aria-label="下移条目"
          className="rounded p-1 text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover disabled:opacity-30"
        >
          <ArrowDown size={13} />
        </button>
        <button data-studio-control="true"
          type="button"
          onClick={onDelete}
          aria-label="删除条目"
          className="rounded p-1 text-slate-400 studio-ui-muted hover:bg-red-50 studio-ui-error-hover hover:text-red-600 studio-ui-error-hover-text"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export function SectionItemsEditor({
  document,
  section,
  onChange,
  onImmediateChange,
}: SectionItemsEditorProps) {
  const emitDiscrete = onImmediateChange ?? onChange;
  const eduDnd = useHandleDragReorder(document.education, (next) =>
    emitDiscrete({ ...document, education: next }),
  );
  const expDnd = useHandleDragReorder(document.experience, (next) =>
    emitDiscrete({ ...document, experience: next }),
  );
  const projDnd = useHandleDragReorder(document.projects, (next) =>
    emitDiscrete({ ...document, projects: next }),
  );
  const customList = document.customData[section.id] ?? [];
  const customDnd = useHandleDragReorder(customList, (next) =>
    emitDiscrete({
      ...document,
      customData: { ...document.customData, [section.id]: next },
    }),
  );

  if (section.id === 'skills') {
    return (
      <MarkdownTextarea
        rows={6}
        value={document.skillContent}
        onChangeValue={(val) => onChange({ ...document, skillContent: val })}
        placeholder="- 持有高中物理教师资格证&#10;- **AI 教研技能**：..."
      />
    );
  }

  if (section.id === 'selfEvaluation') {
    return (
      <MarkdownTextarea
        rows={6}
        value={document.selfEvaluationContent}
        onChangeValue={(val) => onChange({ ...document, selfEvaluationContent: val })}
        placeholder="- 概括核心专业背景与教学/工作优势"
      />
    );
  }

  if (section.id === 'education') {
    const list = document.education;
    const updateItem = (id: string, patch: Partial<EducationItem>) => {
      onChange({
        ...document,
        education: list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    };
    const addItem = () => {
      const next: EducationItem = {
        id: crypto.randomUUID(),
        school: '',
        major: '',
        degree: '',
        startDate: '',
        endDate: '',
        gpa: '',
        description: '',
        visible: true,
        logo: '',
      };
      emitDiscrete({ ...document, education: [...list, next] });
    };
    const duplicateItem = (index: number) => {
      const target = list[index];
      if (!target) return;
      const cloned: EducationItem = { ...target, id: crypto.randomUUID() };
      emitDiscrete({
        ...document,
        education: [...list.slice(0, index + 1), cloned, ...list.slice(index + 1)],
      });
    };

    return (
      <div className="space-y-3">
        {list.map((edu, index) => (
          <div
            key={edu.id}
            {...eduDnd.getContainerProps(index)}
            className={`rounded-md border p-3 transition ${
              eduDnd.overIndex === index && eduDnd.draggingIndex !== index
                ? 'border-t-2 border-t-sky-500 studio-ui-info-top-border border-sky-400 studio-ui-info-border bg-sky-50/40 studio-ui-info-surface'
                : eduDnd.draggingIndex === index
                  ? 'border-slate-300 studio-ui-border bg-slate-100 studio-ui-raised opacity-60'
                  : 'border-slate-200 studio-ui-border bg-slate-50/50 studio-ui-raised'
            }`}
          >
            <ItemToolbar
              title={[edu.school, edu.degree].filter(Boolean).join(' · ')}
              visible={edu.visible}
              index={index}
              total={list.length}
              dragHandleProps={eduDnd.getHandleProps(index)}
              onDuplicate={() => duplicateItem(index)}
              onToggleVisible={() =>
                emitDiscrete({
                  ...document,
                  education: list.map((item) =>
                    item.id === edu.id ? { ...item, visible: !item.visible } : item,
                  ),
                })
              }
              onMoveUp={() => emitDiscrete({ ...document, education: moveItem(list, index, -1) })}
              onMoveDown={() => emitDiscrete({ ...document, education: moveItem(list, index, 1) })}
              onDelete={() =>
                emitDiscrete({ ...document, education: list.filter((x) => x.id !== edu.id) })
              }
            />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input data-studio-control="true"
                type="text"
                value={edu.school}
                onChange={(e) => updateItem(edu.id, { school: e.target.value })}
                placeholder="学校名称"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={edu.major}
                onChange={(e) => updateItem(edu.id, { major: e.target.value })}
                placeholder="专业"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={edu.degree}
                onChange={(e) => updateItem(edu.id, { degree: e.target.value })}
                placeholder="学历（如 硕士）"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={edu.gpa}
                onChange={(e) => updateItem(edu.id, { gpa: e.target.value })}
                placeholder="GPA / 排名"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={edu.startDate}
                onChange={(e) => updateItem(edu.id, { startDate: e.target.value })}
                placeholder="开始时间"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={edu.endDate}
                onChange={(e) => updateItem(edu.id, { endDate: e.target.value })}
                placeholder="结束时间"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
            </div>
            <MarkdownTextarea
              rows={3}
              className="mt-2"
              value={edu.description}
              onChangeValue={(val) => updateItem(edu.id, { description: val })}
              placeholder="- 主修课程、联合培养、科研亮点"
            />
          </div>
        ))}
        <button data-studio-control="true"
          type="button"
          onClick={addItem}
          className="inline-flex w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 studio-ui-border py-1.5 text-xs font-medium text-slate-600 studio-ui-muted hover:border-slate-400 studio-ui-hover-border hover:bg-slate-50 studio-ui-hover"
        >
          <Plus size={13} /> 添加教育经历
        </button>
      </div>
    );
  }

  if (section.id === 'experience') {
    const list = document.experience;
    const updateItem = (id: string, patch: Partial<ExperienceItem>) => {
      onChange({
        ...document,
        experience: list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    };
    const addItem = () => {
      const next: ExperienceItem = {
        id: crypto.randomUUID(),
        company: '',
        position: '',
        startDate: '',
        endDate: '',
        location: '',
        description: '',
        visible: true,
        logo: '',
      };
      emitDiscrete({ ...document, experience: [...list, next] });
    };
    const duplicateItem = (index: number) => {
      const target = list[index];
      if (!target) return;
      const cloned: ExperienceItem = { ...target, id: crypto.randomUUID() };
      emitDiscrete({
        ...document,
        experience: [...list.slice(0, index + 1), cloned, ...list.slice(index + 1)],
      });
    };

    return (
      <div className="space-y-3">
        {list.map((exp, index) => (
          <div
            key={exp.id}
            {...expDnd.getContainerProps(index)}
            className={`rounded-md border p-3 transition ${
              expDnd.overIndex === index && expDnd.draggingIndex !== index
                ? 'border-t-2 border-t-sky-500 studio-ui-info-top-border border-sky-400 studio-ui-info-border bg-sky-50/40 studio-ui-info-surface'
                : expDnd.draggingIndex === index
                  ? 'border-slate-300 studio-ui-border bg-slate-100 studio-ui-raised opacity-60'
                  : 'border-slate-200 studio-ui-border bg-slate-50/50 studio-ui-raised'
            }`}
          >
            <ItemToolbar
              title={[exp.company, exp.position].filter(Boolean).join(' · ')}
              visible={exp.visible}
              index={index}
              total={list.length}
              dragHandleProps={expDnd.getHandleProps(index)}
              onDuplicate={() => duplicateItem(index)}
              onToggleVisible={() =>
                emitDiscrete({
                  ...document,
                  experience: list.map((item) =>
                    item.id === exp.id ? { ...item, visible: !item.visible } : item,
                  ),
                })
              }
              onMoveUp={() => emitDiscrete({ ...document, experience: moveItem(list, index, -1) })}
              onMoveDown={() => emitDiscrete({ ...document, experience: moveItem(list, index, 1) })}
              onDelete={() =>
                emitDiscrete({ ...document, experience: list.filter((x) => x.id !== exp.id) })
              }
            />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input data-studio-control="true"
                type="text"
                value={exp.company}
                onChange={(e) => updateItem(exp.id, { company: e.target.value })}
                placeholder="单位 / 学校名称"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={exp.position}
                onChange={(e) => updateItem(exp.id, { position: e.target.value })}
                placeholder="岗位 / 角色"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={exp.startDate}
                onChange={(e) => updateItem(exp.id, { startDate: e.target.value })}
                placeholder="开始时间"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={exp.endDate}
                onChange={(e) => updateItem(exp.id, { endDate: e.target.value })}
                placeholder="结束时间"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
            </div>
            <MarkdownTextarea
              rows={3}
              className="mt-2"
              value={exp.description}
              onChangeValue={(val) => updateItem(exp.id, { description: val })}
              placeholder="- 工作职责与核心成果"
            />
          </div>
        ))}
        <button data-studio-control="true"
          type="button"
          onClick={addItem}
          className="inline-flex w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 studio-ui-border py-1.5 text-xs font-medium text-slate-600 studio-ui-muted hover:border-slate-400 studio-ui-hover-border hover:bg-slate-50 studio-ui-hover"
        >
          <Plus size={13} /> 添加工作/实习经历
        </button>
      </div>
    );
  }

  if (section.id === 'projects') {
    const list = document.projects;
    const updateItem = (id: string, patch: Partial<ProjectItem>) => {
      onChange({
        ...document,
        projects: list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    };
    const addItem = () => {
      const next: ProjectItem = {
        id: crypto.randomUUID(),
        name: '',
        role: '',
        date: '',
        description: '',
        link: '',
        linkLabel: '',
        visible: true,
      };
      emitDiscrete({ ...document, projects: [...list, next] });
    };
    const duplicateItem = (index: number) => {
      const target = list[index];
      if (!target) return;
      const cloned: ProjectItem = { ...target, id: crypto.randomUUID() };
      emitDiscrete({
        ...document,
        projects: [...list.slice(0, index + 1), cloned, ...list.slice(index + 1)],
      });
    };

    return (
      <div className="space-y-3">
        {list.map((proj, index) => (
          <div
            key={proj.id}
            {...projDnd.getContainerProps(index)}
            className={`rounded-md border p-3 transition ${
              projDnd.overIndex === index && projDnd.draggingIndex !== index
                ? 'border-t-2 border-t-sky-500 studio-ui-info-top-border border-sky-400 studio-ui-info-border bg-sky-50/40 studio-ui-info-surface'
                : projDnd.draggingIndex === index
                  ? 'border-slate-300 studio-ui-border bg-slate-100 studio-ui-raised opacity-60'
                  : 'border-slate-200 studio-ui-border bg-slate-50/50 studio-ui-raised'
            }`}
          >
            <ItemToolbar
              title={proj.name}
              visible={proj.visible}
              index={index}
              total={list.length}
              dragHandleProps={projDnd.getHandleProps(index)}
              onDuplicate={() => duplicateItem(index)}
              onToggleVisible={() =>
                emitDiscrete({
                  ...document,
                  projects: list.map((item) =>
                    item.id === proj.id ? { ...item, visible: !item.visible } : item,
                  ),
                })
              }
              onMoveUp={() => emitDiscrete({ ...document, projects: moveItem(list, index, -1) })}
              onMoveDown={() => emitDiscrete({ ...document, projects: moveItem(list, index, 1) })}
              onDelete={() =>
                emitDiscrete({ ...document, projects: list.filter((x) => x.id !== proj.id) })
              }
            />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input data-studio-control="true"
                type="text"
                value={proj.name}
                onChange={(e) => updateItem(proj.id, { name: e.target.value })}
                placeholder="项目名称"
                className="col-span-2 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={proj.role}
                onChange={(e) => updateItem(proj.id, { role: e.target.value })}
                placeholder="担任角色"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={proj.date}
                onChange={(e) => updateItem(proj.id, { date: e.target.value })}
                placeholder="时间范围"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={proj.link}
                onChange={(e) => updateItem(proj.id, { link: e.target.value })}
                placeholder="相关链接（可选）"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
              <input data-studio-control="true"
                type="text"
                value={proj.linkLabel}
                onChange={(e) => updateItem(proj.id, { linkLabel: e.target.value })}
                placeholder="链接文字（可选）"
                className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
              />
            </div>
            <MarkdownTextarea
              rows={4}
              className="mt-2"
              value={proj.description}
              onChangeValue={(val) => updateItem(proj.id, { description: val })}
              placeholder="- 项目背景、方案设计与量化成果"
            />
          </div>
        ))}
        <button data-studio-control="true"
          type="button"
          onClick={addItem}
          className="inline-flex w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 studio-ui-border py-1.5 text-xs font-medium text-slate-600 studio-ui-muted hover:border-slate-400 studio-ui-hover-border hover:bg-slate-50 studio-ui-hover"
        >
          <Plus size={13} /> 添加项目经历
        </button>
      </div>
    );
  }

  const list = document.customData[section.id] ?? [];
  const updateCustomList = (nextList: CustomItem[], discrete = false) => {
    const nextDoc: ResumeDocument = {
      ...document,
      customData: {
        ...document.customData,
        [section.id]: nextList,
      },
    };
    if (discrete) {
      emitDiscrete(nextDoc);
    } else {
      onChange(nextDoc);
    }
  };
  const duplicateCustomItem = (index: number) => {
    const target = list[index];
    if (!target) return;
    const cloned: CustomItem = { ...target, id: crypto.randomUUID() };
    updateCustomList([...list.slice(0, index + 1), cloned, ...list.slice(index + 1)], true);
  };

  return (
    <div className="space-y-3">
      {list.map((item, index) => (
        <div
          key={item.id}
          {...customDnd.getContainerProps(index)}
          className={`rounded-md border p-3 transition ${
            customDnd.overIndex === index && customDnd.draggingIndex !== index
              ? 'border-t-2 border-t-sky-500 studio-ui-info-top-border border-sky-400 studio-ui-info-border bg-sky-50/40 studio-ui-info-surface'
              : customDnd.draggingIndex === index
                ? 'border-slate-300 studio-ui-border bg-slate-100 studio-ui-raised opacity-60'
                : 'border-slate-200 studio-ui-border bg-slate-50/50 studio-ui-raised'
          }`}
        >
          <ItemToolbar
            title={item.title}
            visible={item.visible}
            index={index}
            total={list.length}
            dragHandleProps={customDnd.getHandleProps(index)}
            onDuplicate={() => duplicateCustomItem(index)}
            onToggleVisible={() =>
              updateCustomList(
                list.map((x) => (x.id === item.id ? { ...x, visible: !x.visible } : x)),
                true,
              )
            }
            onMoveUp={() => updateCustomList(moveItem(list, index, -1), true)}
            onMoveDown={() => updateCustomList(moveItem(list, index, 1), true)}
            onDelete={() => updateCustomList(list.filter((x) => x.id !== item.id), true)}
          />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <input data-studio-control="true"
              type="text"
              value={item.title}
              onChange={(e) =>
                updateCustomList(
                  list.map((x) => (x.id === item.id ? { ...x, title: e.target.value } : x)),
                )
              }
              placeholder="标题"
              className="col-span-2 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
            />
            <input data-studio-control="true"
              type="text"
              value={item.subtitle}
              onChange={(e) =>
                updateCustomList(
                  list.map((x) => (x.id === item.id ? { ...x, subtitle: e.target.value } : x)),
                )
              }
              placeholder="副标题（可选）"
              className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
            />
            <input data-studio-control="true"
              type="text"
              value={item.dateRange}
              onChange={(e) =>
                updateCustomList(
                  list.map((x) => (x.id === item.id ? { ...x, dateRange: e.target.value } : x)),
                )
              }
              placeholder="时间（可选）"
              className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1.5 text-slate-900 studio-ui-primary"
            />
          </div>
          <MarkdownTextarea
            rows={2}
            className="mt-2"
            value={item.description}
            onChangeValue={(val) =>
              updateCustomList(
                list.map((x) => (x.id === item.id ? { ...x, description: val } : x)),
              )
            }
            placeholder="补充描述（可选）"
          />
        </div>
      ))}
      <button data-studio-control="true"
        type="button"
        onClick={() =>
          updateCustomList(
            [
              ...list,
              {
                id: crypto.randomUUID(),
                title: '',
                subtitle: '',
                dateRange: '',
                description: '',
                visible: true,
              },
            ],
            true,
          )
        }
        className="inline-flex w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 studio-ui-border py-1.5 text-xs font-medium text-slate-600 studio-ui-muted hover:border-slate-400 studio-ui-hover-border hover:bg-slate-50 studio-ui-hover"
      >
        <Plus size={13} /> 添加条目
      </button>
    </div>
  );
}
