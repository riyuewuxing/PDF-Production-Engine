import {
  Check,
  Maximize2,
  Palette,
  Search,
  Sparkles,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLE_PREVIEW_DOCUMENT, withPreviewDemoPhoto } from '../../lib/sampleResumeData';
import type { ResumeDocument, TemplateId } from '../../schema/resumeSchema';
import { TEMPLATE_REGISTRY } from '../../templates/registry';
import type { TemplateMetadata } from '../../templates/types';
import type { StudioThemeId } from '../../studio-theme/presets';
import { surfaceStyle } from '../../studio-theme/surfaces';

interface TemplateGalleryProps {
  studioThemeId?: StudioThemeId;
  activeDocument: ResumeDocument;
  onSelectTemplate: (templateId: TemplateId, applyRecommendedColor?: string) => void;
}

const FAVORITES_STORAGE_KEY = 'resume-studio:favorite-templates';

function loadFavoriteTemplates(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavoriteTemplates(ids: Set<string>): void {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage quota errors
  }
}

type GalleryTabId =
  | 'all'
  | 'favorites'
  | 'vip-wave'
  | 'vip-sidebar'
  | 'vip-banner'
  | 'teacher'
  | 'minimal'
  | 'academic';

const CATEGORY_TABS: Array<{
  id: GalleryTabId;
  label: string;
  match: (t: TemplateMetadata, favorites: Set<string>) => boolean;
}> = [
  { id: 'all', label: '全部模板', match: () => true },
  {
    id: 'favorites',
    label: '★ 我的收藏',
    match: (t, favorites) => favorites.has(t.id),
  },
  {
    id: 'vip-wave',
    label: 'VIP波浪弧线',
    match: (t) => t.category === 'vip-wave',
  },
  {
    id: 'vip-sidebar',
    label: 'VIP强色侧栏',
    match: (t) =>
      t.category === 'vip-sidebar' ||
      t.category === 'sidebar' ||
      t.id === 'wondercv-teal-sidebar' ||
      t.id === 'wondercv-soft-right',
  },
  {
    id: 'vip-banner',
    label: 'VIP横幅与暗黑',
    match: (t) =>
      t.category === 'vip-banner' ||
      (t.category === 'commercial' &&
        t.id !== 'wondercv-teal-sidebar' &&
        t.id !== 'wondercv-soft-right'),
  },
  { id: 'teacher', label: '教师考编', match: (t) => t.category === 'teacher' },
  { id: 'minimal', label: '极简大厂ATS', match: (t) => t.category === 'minimal' },
  { id: 'academic', label: '科研学术', match: (t) => t.category === 'academic' },
];

const LIGHTBOX_SWATCHES = [
  '#3b82f6',
  '#167883',
  '#9f1239',
  '#1d4ed8',
  '#115e59',
  '#7c3aed',
  '#ea580c',
  '#1f2937',
];

function LiveThumbnailCard({
  meta,
  previewDoc,
  isActive,
  isFavorite,
  autoApplyRecommendedColor,
  onSelect,
  onInspect,
  onToggleFavorite,
}: {
  meta: TemplateMetadata;
  previewDoc: ResumeDocument;
  isActive: boolean;
  isFavorite: boolean;
  autoApplyRecommendedColor: boolean;
  onSelect: () => void;
  onInspect: () => void;
  onToggleFavorite: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );
  const [cardWidth, setCardWidth] = useState(236);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setCardWidth(el.clientWidth);
      }
    };
    updateWidth();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateWidth);
      ro.observe(el);
    }

    if (mounted) {
      return () => ro?.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: '260px' },
    );
    observer.observe(el);

    return () => {
      ro?.disconnect();
      observer.disconnect();
    };
  }, [mounted]);

  const cardDoc: ResumeDocument = useMemo(
    () => ({
      ...previewDoc,
      templateId: meta.id,
      globalSettings: {
        ...previewDoc.globalSettings,
        themeColor: autoApplyRecommendedColor
          ? meta.recommendedColor
          : previewDoc.globalSettings.themeColor,
      },
    }),
    [autoApplyRecommendedColor, meta.id, meta.recommendedColor, previewDoc],
  );

  const TemplateComponent = meta.component;
  const scale = Math.round((cardWidth / 794) * 1000) / 1000;

  return (
    <div
      data-studio-gallery-card={meta.id}
      className={`group flex flex-col overflow-hidden rounded-lg border bg-[#1b222e] studio-ui-raised transition ${
        isActive
          ? 'border-teal-400 studio-ui-selected-border ring-2 ring-teal-400/40 studio-ui-ring'
          : 'border-slate-700/80 studio-ui-border hover:border-teal-500/70 studio-ui-hover-border'
      }`}
    >
      {/* Full-bleed adaptive A4 Thumbnail Surface */}
      <div
        ref={hostRef}
        className="relative aspect-[210/297] w-full overflow-hidden bg-white shadow-inner"
      >
        {mounted ? (
          <div
            data-studio-paper="thumbnail"
            className="pointer-events-none origin-top-left select-none"
            style={{
              width: '794px',
              transform: `scale(${scale})`,
            }}
          >
            <TemplateComponent document={cardDoc} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-slate-100 text-[11px] text-slate-400">
            加载实时预览...
          </div>
        )}

        {isActive && (
          <span className="pointer-events-none absolute top-2 left-2 z-20 inline-flex items-center gap-1 rounded-full bg-teal-600 studio-ui-fill px-2 py-0.5 text-[10px] font-semibold text-white studio-ui-on-fill shadow">
            <Check size={10} /> 使用中
          </span>
        )}

        {meta.id.startsWith('vip-') && (
          <span className="pointer-events-none absolute top-2 right-9 z-20 rounded bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-slate-950 shadow">
            VIP
          </span>
        )}

        <button data-studio-control="true"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={isFavorite ? `取消收藏 ${meta.name}` : `收藏 ${meta.name}`}
          title={isFavorite ? '已收藏，点击取消' : '收藏到我的模板'}
          className={`absolute top-1.5 right-1.5 z-30 rounded-full p-1 shadow transition ${
            isFavorite
              ? 'bg-amber-400 text-slate-950'
              : 'bg-slate-900/70 text-slate-200 opacity-85 hover:bg-slate-900 hover:text-amber-300'
          }`}
        >
          <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>

        {/* Glassmorphic hover/focus action overlay */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/60 opacity-0 backdrop-blur-[1.5px] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button data-studio-control="true"
            type="button"
            onClick={onSelect}
            className="inline-flex items-center gap-1.5 rounded-full bg-teal-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-teal-400"
          >
            <Check size={13} />
            一键应用
          </button>
          <button data-studio-control="true"
            type="button"
            onClick={onInspect}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/35 bg-slate-900/80 px-3.5 py-1.5 text-xs font-medium text-white shadow hover:bg-slate-800"
          >
            <Maximize2 size={12} />
            大图放大对比
          </button>
        </div>
      </div>

      {/* Compact single-line footer */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-800 studio-ui-border bg-[#171d28] studio-ui-surface px-2.5 py-2 text-slate-100 studio-ui-primary">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold" title={meta.subtitle}>
            {meta.name}
          </h3>
        </div>
        <span
          className="h-3 w-3 shrink-0 rounded-full border border-white/30"
          title={`推荐主题色 ${meta.recommendedColor}`}
          style={{ backgroundColor: meta.recommendedColor }}
        />
      </div>
    </div>
  );
}

function TemplateLightboxModal({
  meta,
  previewDoc,
  initialColor,
  isFavorite,
  onToggleFavorite,
  onClose,
  onApply,
}: {
  meta: TemplateMetadata;
  previewDoc: ResumeDocument;
  initialColor: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  onApply: (color: string) => void;
}) {
  const [trialColor, setTrialColor] = useState(initialColor);
  const dialogRef = useRef<HTMLDivElement>(null);
  const TemplateComponent = meta.component;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0);
    const focusInitial = () => (dialog.querySelector<HTMLElement>('[aria-label="关闭大图对比"]') ?? focusable()[0] ?? dialog).focus({ preventScroll: true });
    focusInitial();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (!active || !dialog.contains(active) || active === dialog || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusInitial();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [onClose]);

  const modalDoc: ResumeDocument = useMemo(
    () => ({
      ...previewDoc,
      templateId: meta.id,
      globalSettings: {
        ...previewDoc.globalSettings,
        themeColor: trialColor,
      },
    }),
    [meta.id, previewDoc, trialColor],
  );

  const colorPalette = useMemo(
    () => [meta.recommendedColor, ...LIGHTBOX_SWATCHES.filter((c) => c !== meta.recommendedColor)].slice(0, 8),
    [meta.recommendedColor],
  );

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`模板大图对比：${meta.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700 studio-ui-border bg-[#141922] studio-ui-surface text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 studio-ui-border bg-[#19202c] studio-ui-raised studio-ui-primary px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-bold text-white studio-ui-primary">{meta.name}</h2>
              {meta.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-slate-800 studio-ui-raised px-1.5 py-0.5 text-[10px] text-slate-300 studio-ui-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-400 studio-ui-muted">{meta.subtitle}</p>
          </div>

          <div className="flex items-center gap-3">
            <button data-studio-control="true"
              type="button"
              onClick={onToggleFavorite}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                isFavorite
                  ? 'border-amber-400 studio-ui-warning-border bg-amber-400/15 studio-ui-warning-surface text-amber-300 studio-ui-warning'
                  : 'border-slate-700 studio-ui-border bg-slate-900 studio-ui-raised text-slate-300 studio-ui-muted hover:bg-slate-800 studio-ui-hover'
              }`}
            >
              <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
              {isFavorite ? '已收藏' : '收藏'}
            </button>

            <div className="flex items-center gap-1.5 rounded-full border border-slate-700 studio-ui-border bg-slate-900 studio-ui-raised px-2.5 py-1">
              <span className="text-[11px] text-slate-400 studio-ui-muted">试色：</span>
              {colorPalette.map((hex) => (
                <button data-studio-control="true"
                  key={hex}
                  type="button"
                  onClick={() => setTrialColor(hex)}
                  aria-label={`试色 ${hex}`}
                  className={`h-4 w-4 rounded-full border transition ${
                    trialColor.toLowerCase() === hex.toLowerCase()
                      ? 'scale-110 ring-2 ring-white studio-ui-ring border-white'
                      : 'border-white/30 hover:scale-110'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>

            <button data-studio-control="true"
              type="button"
              onClick={() => onApply(trialColor)}
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 studio-ui-fill px-3.5 py-1.5 text-xs font-semibold text-white studio-ui-on-fill hover:bg-teal-500 studio-ui-fill-hover"
            >
              <Check size={13} /> 应用此模板并开始编辑
            </button>

            <button data-studio-control="true"
              type="button"
              onClick={onClose}
              aria-label="关闭大图对比"
              className="rounded-md p-1.5 text-slate-400 studio-ui-muted hover:bg-slate-800 studio-ui-hover hover:text-white studio-ui-hover-primary"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* High-res Scrollable Sheet Area */}
        <div className="flex-1 overflow-auto bg-[#1b2230] studio-ui-raised p-6">
          <div className="mx-auto w-[794px] max-w-full origin-top shadow-2xl ring-1 ring-black/40">
            <div data-studio-paper="lightbox" className="a4-sheet bg-white">
              <TemplateComponent document={modalDoc} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplateGallery({
  studioThemeId = 'classic',
  activeDocument,
  onSelectTemplate,
}: TemplateGalleryProps) {
  const [category, setCategory] = useState<GalleryTabId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewMode, setPreviewMode] = useState<'mine' | 'sample'>('mine');
  const [fillDemoAvatar, setFillDemoAvatar] = useState(true);
  const [applyRecommendedColor, setApplyRecommendedColor] = useState(true);
  const [inspectMeta, setInspectMeta] = useState<TemplateMetadata | null>(null);
  const closeInspect = useCallback(() => setInspectMeta(null), []);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavoriteTemplates());

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavoriteTemplates(next);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const activeTab = CATEGORY_TABS.find((t) => t.id === category) ?? CATEGORY_TABS[0]!;
    const q = searchQuery.trim().toLowerCase();
    return TEMPLATE_REGISTRY.filter((t) => {
      if (!activeTab.match(t, favorites)) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.subtitle.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [category, favorites, searchQuery]);

  const rawBaseDoc = previewMode === 'mine' ? activeDocument : SAMPLE_PREVIEW_DOCUMENT;
  const effectivePreviewDoc = useMemo(
    () => withPreviewDemoPhoto(rawBaseDoc, fillDemoAvatar),
    [rawBaseDoc, fillDemoAvatar],
  );

  return (
    <div data-studio-surface="gallery" data-studio-theme={studioThemeId} style={surfaceStyle(studioThemeId, 'gallery')} className="flex min-w-0 flex-1 flex-col bg-[#141922] text-slate-100">
      {/* Gallery Filter & Tools Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 studio-ui-border bg-[#181e29] studio-ui-raised studio-ui-primary px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_TABS.map((tab) => {
            const count = TEMPLATE_REGISTRY.filter((t) => tab.match(t, favorites)).length;
            const active = category === tab.id;
            return (
              <button data-studio-control="true"
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  active
                    ? 'bg-teal-600 studio-ui-fill text-white studio-ui-on-fill'
                    : 'bg-slate-800/80 studio-ui-raised text-slate-300 studio-ui-muted hover:bg-slate-700 studio-ui-hover'
                }`}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
          <label className="relative flex items-center">
            <Search size={12} className="pointer-events-none absolute left-2.5 text-slate-400 studio-ui-muted" />
            <input data-studio-control="true"
              type="search"
              data-native-undo="true"
              aria-label="搜索模板"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索突出 / 波浪 / 侧栏..."
              className="w-40 rounded-md border border-slate-700 studio-ui-border bg-slate-900 studio-ui-raised py-1 pr-2 pl-7 text-[11px] text-slate-100 studio-ui-primary placeholder:text-slate-500 focus:border-teal-500 studio-ui-focus-border focus:outline-none"
            />
          </label>

          <div className="inline-flex overflow-hidden rounded-md border border-slate-700 studio-ui-border bg-slate-900 studio-ui-raised p-0.5">
            <button data-studio-control="true"
              type="button"
              onClick={() => setPreviewMode('mine')}
              className={`rounded px-2 py-1 transition ${
                previewMode === 'mine'
                  ? 'bg-slate-700 studio-ui-selected font-medium text-white studio-ui-selected-text'
                  : 'text-slate-400 studio-ui-muted hover:text-slate-200 studio-ui-hover-primary'
              }`}
            >
              用我的简历预览
            </button>
            <button data-studio-control="true"
              type="button"
              onClick={() => setPreviewMode('sample')}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 transition ${
                previewMode === 'sample'
                  ? 'bg-slate-700 studio-ui-selected font-medium text-white studio-ui-selected-text'
                  : 'text-slate-400 studio-ui-muted hover:text-slate-200 studio-ui-hover-primary'
              }`}
            >
              <Sparkles size={11} /> 示例数据
            </button>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-1 text-slate-300 studio-ui-muted">
            <input data-studio-control="true"
              type="checkbox"
              checked={fillDemoAvatar}
              onChange={(e) => setFillDemoAvatar(e.target.checked)}
              className="rounded border-slate-600 studio-ui-border bg-slate-800 studio-ui-raised"
            />
            <UserCheck size={12} className="text-sky-400 studio-ui-info" />
            <span>无照片时补示范头像预览</span>
          </label>

          <label className="inline-flex cursor-pointer items-center gap-1 text-slate-300 studio-ui-muted">
            <input data-studio-control="true"
              type="checkbox"
              checked={applyRecommendedColor}
              onChange={(e) => setApplyRecommendedColor(e.target.checked)}
              className="rounded border-slate-600 studio-ui-border bg-slate-800 studio-ui-raised"
            />
            <Palette size={12} className="text-teal-400 studio-ui-selected-text" />
            <span>切换时应用推荐配色</span>
          </label>
        </div>
      </div>

      {/* High-density 4-5 Column Live Thumbnail Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-400 studio-ui-muted">
            {category === 'favorites'
              ? '暂无收藏模板，点击卡片右上角星标即可快速收藏。'
              : `未找到匹配“${searchQuery}”的模板，试试清空筛选条件。`}
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1600px] grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((meta) => (
              <LiveThumbnailCard
                key={meta.id}
                meta={meta}
                previewDoc={effectivePreviewDoc}
                isActive={activeDocument.templateId === meta.id}
                isFavorite={favorites.has(meta.id)}
                autoApplyRecommendedColor={applyRecommendedColor}
                onSelect={() =>
                  onSelectTemplate(
                    meta.id,
                    applyRecommendedColor ? meta.recommendedColor : undefined,
                  )
                }
                onInspect={() => setInspectMeta(meta)}
                onToggleFavorite={() => toggleFavorite(meta.id)}
              />
            ))}
          </div>
        )}
      </div>

      {inspectMeta && (
        <TemplateLightboxModal
          meta={inspectMeta}
          previewDoc={effectivePreviewDoc}
          initialColor={
            applyRecommendedColor
              ? inspectMeta.recommendedColor
              : activeDocument.globalSettings.themeColor
          }
          isFavorite={favorites.has(inspectMeta.id)}
          onToggleFavorite={() => toggleFavorite(inspectMeta.id)}
          onClose={closeInspect}
          onApply={(chosenColor) => {
            onSelectTemplate(inspectMeta.id, chosenColor);
            setInspectMeta(null);
          }}
        />
      )}
    </div>
  );
}
