import { Check, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { DENSITY_LIMITS } from '../../lib/pageFit';
import type { GlobalSettings } from '../../schema/resumeSchema';
import { FONT_STACKS } from '../../templates/shared';
import type { TemplateMetadata } from '../../templates/types';

interface StyleAndColorPaneProps {
  settings: GlobalSettings;
  templateMeta?: TemplateMetadata;
  onChange: (next: GlobalSettings) => void;
  onResetToDefault?: () => void;
  onSwitchLocale?: (locale: 'zh-CN' | 'en-US') => void;
}

const COMMERCIAL_THEME_COLORS: Array<{ hex: string; label: string }> = [
  { hex: '#167883', label: '超级青绿' },
  { hex: '#3b82f6', label: '晴空蓝' },
  { hex: '#2859b6', label: '皇室蓝' },
  { hex: '#1e3a5f', label: '深海军蓝' },
  { hex: '#0f4c81', label: '普鲁士蓝' },
  { hex: '#166534', label: '学院墨绿' },
  { hex: '#0d9488', label: '翡翠青' },
  { hex: '#881337', label: '端庄酒红' },
  { hex: '#7c2d12', label: '暖咖棕' },
  { hex: '#4c1d95', label: '深紫罗兰' },
  { hex: '#111827', label: '石墨黑' },
  { hex: '#334155', label: '炭灰' },
];

const PAPER_BACKGROUNDS: Array<{ hex: string; label: string }> = [
  { hex: '#ffffff', label: '纯白' },
  { hex: '#fdfcf8', label: '象牙纸白' },
  { hex: '#f8fafc', label: '浅冷灰' },
  { hex: '#f3f7fc', label: '柔雾浅蓝' },
  { hex: '#f2f9f9', label: '淡雅青绿' },
];

const SURFACE_STYLES: Array<{ id: GlobalSettings['surfaceStyle']; label: string }> = [
  { id: 'solid', label: '饱和纯色' },
  { id: 'gradient', label: '线性渐变' },
  { id: 'tint', label: '浅柔省墨' },
  { id: 'outline', label: '极简线框' },
];

const HEADING_STYLES: Array<{ id: GlobalSettings['headingStyle']; label: string }> = [
  { id: 'auto', label: '跟随模板' },
  { id: 'circle-icon', label: '圆底图标' },
  { id: 'trapezoid-flag', label: '斜切梯形旗' },
  { id: 'ribbon-fold', label: '立体折角丝带' },
  { id: 'dot-accent', label: '棱点细线' },
  { id: 'block-tag', label: '实心色块签' },
  { id: 'left-bar', label: '左侧竖线' },
  { id: 'double-line', label: '上下双线' },
  { id: 'pill', label: '胶囊色块' },
  { id: 'clean', label: '极简细线' },
];

export const FONT_FAMILY_PRESETS: Array<{
  id: GlobalSettings['fontFamily'];
  label: string;
  primaryFont: string;
  desc: string;
}> = [
  { id: 'sans', label: '标准无衬线黑体', primaryFont: 'MiSans', desc: 'MiSans / 等线 / 微软雅黑' },
  { id: 'serif', label: '经典宋体衬线', primaryFont: 'SimSun', desc: '宋体 / 华文宋体 / 传统衬线' },
  { id: 'misans', label: '清雅等线 MiSans', primaryFont: 'MiSans', desc: '小米兰亭 / Win 等线' },
  { id: 'yahei', label: '商务微软雅黑', primaryFont: 'Microsoft YaHei', desc: 'Windows 清晰商务体' },
  { id: 'kaiti', label: '温润人文楷体', primaryFont: 'KaiTi', desc: '师范 / 文学手写风' },
  { id: 'fangsong', label: '公文考编仿宋', primaryFont: 'FangSong', desc: '机关单位 / 正式档案' },
  { id: 'hei', label: '醒目稳重黑体', primaryFont: 'SimHei', desc: '标题冲击力强' },
  { id: 'tech', label: '极客双拼等宽数字', primaryFont: 'Segoe UI', desc: 'Segoe UI + Consolas' },
];

const RECOMMENDED_CJK_CUSTOM_FONTS: Array<{ value: string; label: string }> = [
  { value: 'Noto Sans SC', label: 'Noto Sans SC（思源黑体）' },
  { value: 'Noto Serif SC', label: 'Noto Serif SC（思源宋体）' },
  { value: 'MiSans', label: 'MiSans（小米现代无衬线）' },
  { value: 'DengXian', label: 'DengXian（等线）' },
  { value: 'Microsoft YaHei', label: 'Microsoft YaHei（微软雅黑）' },
  { value: 'KaiTi', label: 'KaiTi（楷体）' },
  { value: 'FangSong', label: 'FangSong（仿宋）' },
  { value: 'SimHei', label: 'SimHei（黑体）' },
  { value: 'SimSun', label: 'SimSun（宋体）' },
  { value: 'Segoe UI', label: 'Segoe UI（极简西文）' },
  { value: 'Consolas', label: 'Consolas（等宽代码）' },
];

const FONT_LOCALIZED_ALIASES: Record<string, string[]> = {
  'noto sans sc': ['思源黑体'],
  'noto serif sc': ['思源宋体'],
  misans: ['misans', 'misans regular'],
  'microsoft yahei': ['微软雅黑'],
  kaiti: ['楷体', 'kaiti_gb2312'],
  fangsong: ['仿宋', 'fangsong_gb2312'],
  simhei: ['黑体'],
  simsun: ['宋体'],
  dengxian: ['等线'],
  stkaiti: ['华文楷体'],
  stfangsong: ['华文仿宋'],
  stxihei: ['华文细黑'],
  stsong: ['华文宋体'],
};

export function StyleAndColorPane({
  settings,
  templateMeta,
  onChange,
  onResetToDefault,
  onSwitchLocale,
}: StyleAndColorPaneProps) {
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontSourceNote, setFontSourceNote] = useState<string>('');
  const [loadingFonts, setLoadingFonts] = useState(false);

  const loadFonts = () => {
    setLoadingFonts(true);
    void apiClient
      .listSystemFonts()
      .then((res) => {
        setSystemFonts(res.fonts);
        setFontSourceNote(res.note ?? '');
      })
      .catch(() => {
        setSystemFonts(RECOMMENDED_CJK_CUSTOM_FONTS.map((f) => f.value));
      })
      .finally(() => setLoadingFonts(false));
  };

  useEffect(() => {
    loadFonts();
  }, []);

  const installedSet = useMemo(() => {
    const s = new Set<string>();
    for (const f of systemFonts) {
      const lower = f.toLowerCase();
      s.add(lower);
      for (const [enKey, aliases] of Object.entries(FONT_LOCALIZED_ALIASES)) {
        if (lower === enKey || aliases.includes(lower)) {
          s.add(enKey);
          aliases.forEach((a) => s.add(a));
        }
      }
    }
    return s;
  }, [systemFonts]);

  const otherSystemFonts = useMemo(() => {
    const recommendedHidden = new Set<string>();
    for (const r of RECOMMENDED_CJK_CUSTOM_FONTS) {
      const lower = r.value.toLowerCase();
      recommendedHidden.add(lower);
      (FONT_LOCALIZED_ALIASES[lower] ?? []).forEach((a) => recommendedHidden.add(a));
    }
    return systemFonts.filter((name) => !recommendedHidden.has(name.toLowerCase()));
  }, [systemFonts]);

  const patch = <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const handleReset = () => {
    if (onResetToDefault) {
      onResetToDefault();
      return;
    }
    onChange({
      ...settings,
      baseFontSize: 13,
      pagePadding: 28,
      paragraphSpacing: 10,
      lineHeight: 1.32,
      sectionSpacing: 16,
      headerSize: 15,
      subheaderSize: 13,
      useIconMode: true,
      themeColor: templateMeta?.recommendedColor ?? '#167883',
      paperBackground: '#ffffff',
      surfaceStyle: 'solid',
      headingStyle: 'auto',
      fontFamily:
        templateMeta?.id === 'classic-serif' || templateMeta?.id === 'harvard-academic'
          ? 'serif'
          : 'sans',
      customFontFamily: '',
      letterSpacing: 0,
      headingWeight: 'bold',
      tabularNums: true,
      showPageGuide: true,
      avoidItemSplit: true,
      autoCjkSpacing: false,
    });
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
        <div>
          <div className="text-xs font-bold text-slate-900">样式与排印引擎</div>
          <div className="text-[11px] text-slate-500">配色、纸张、中文排印与本机字体覆盖</div>
        </div>
        <button
          type="button"
          onClick={handleReset}
          title="将配色、纸张、字体与字号间距恢复到当前模板默认设定（支持 Ctrl+Z 撤回）"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
        >
          <RotateCcw size={11} /> 恢复模板默认样式
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
        {/* Language / Locale Toggle */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-slate-800">简历语言（中英模板标签互译）</span>
            <span className="text-[10px] text-slate-400">可 Ctrl+Z 撤回</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['zh-CN', '中文简历 (zh-CN)'],
                ['en-US', 'English CV (en-US)'],
              ] as const
            ).map(([loc, label]) => {
              const active = (settings.locale ?? 'zh-CN') === loc;
              return (
                <button
                  key={loc}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (onSwitchLocale) {
                      onSwitchLocale(loc);
                    } else {
                      patch('locale', loc);
                    }
                  }}
                  className={`rounded border px-2.5 py-1.5 font-medium transition ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Theme Color */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-slate-800">主题主色</span>
            <span className="font-mono text-[11px] text-slate-500">{settings.themeColor}</span>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {COMMERCIAL_THEME_COLORS.map((preset) => {
              const active = settings.themeColor.toLowerCase() === preset.hex;
              return (
                <button
                  key={preset.hex}
                  type="button"
                  onClick={() => patch('themeColor', preset.hex)}
                  title={preset.label}
                  aria-label={`主题色 ${preset.label}`}
                  className={`flex h-7 items-center justify-center rounded-md border transition ${
                    active
                      ? 'ring-2 ring-slate-900 ring-offset-1 border-slate-900'
                      : 'border-slate-200 hover:scale-105'
                  }`}
                  style={{ backgroundColor: preset.hex }}
                />
              );
            })}
          </div>
          <label className="mt-2 flex items-center justify-between rounded border border-slate-200 px-2.5 py-1.5 text-slate-600">
            <span>自定义 HEX 取色</span>
            <input
              type="color"
              aria-label="自定义主题色"
              value={settings.themeColor}
              onChange={(e) => patch('themeColor', e.target.value)}
              className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </section>

        {/* Paper Background */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-slate-800">纸张底色</span>
            <span className="font-mono text-[11px] text-slate-500">{settings.paperBackground}</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {PAPER_BACKGROUNDS.map((bg) => {
              const active = settings.paperBackground.toLowerCase() === bg.hex;
              return (
                <button
                  key={bg.hex}
                  type="button"
                  onClick={() => patch('paperBackground', bg.hex)}
                  aria-label={`纸张底色 ${bg.label}`}
                  className={`flex flex-col items-center gap-1 rounded border p-1.5 ${
                    active
                      ? 'border-slate-900 ring-1 ring-slate-900'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <span
                    className="h-5 w-full rounded border border-slate-200"
                    style={{ backgroundColor: bg.hex }}
                  />
                  <span className="text-[10px] text-slate-600">{bg.label}</span>
                </button>
              );
            })}
          </div>
          <label className="mt-2 flex items-center justify-between rounded border border-slate-200 px-2.5 py-1.5 text-slate-600">
            <span>自定义纸张底色</span>
            <input
              type="color"
              aria-label="自定义纸张底色"
              value={settings.paperBackground}
              onChange={(e) => patch('paperBackground', e.target.value)}
              className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </section>

        {/* Surface Style */}
        <section>
          <div className="mb-2 font-semibold text-slate-800">侧栏 / 页眉填充模式</div>
          <div className="grid grid-cols-2 gap-1.5">
            {SURFACE_STYLES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => patch('surfaceStyle', item.id)}
                className={`rounded border px-2.5 py-1.5 font-medium transition ${
                  settings.surfaceStyle === item.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {/* Heading Style */}
        <section>
          <div className="mb-2 font-semibold text-slate-800">章节标题风格</div>
          <div className="grid grid-cols-2 gap-1.5">
            {HEADING_STYLES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => patch('headingStyle', item.id)}
                className={`rounded border px-2 py-1.5 font-medium transition ${
                  settings.headingStyle === item.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {/* 8 Curated Chinese Font Stacks + Custom OS Font Override */}
        <section className="space-y-2.5 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">精选中文排印字体（8 套）</span>
            <button
              type="button"
              onClick={loadFonts}
              disabled={loadingFonts}
              className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-900"
            >
              <RefreshCw size={10} className={loadingFonts ? 'animate-spin' : ''} /> 刷新本机字体
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {FONT_FAMILY_PRESETS.map((item) => {
              const active = settings.fontFamily === item.id && !settings.customFontFamily;
              const hit = installedSet.size > 0 && installedSet.has(item.primaryFont.toLowerCase());
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChange({
                      ...settings,
                      fontFamily: item.id,
                      customFontFamily: '',
                    });
                  }}
                  aria-pressed={active}
                  className={`rounded border p-2 text-left transition ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-semibold">{item.label}</span>
                    {installedSet.size > 0 && (
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${
                          hit
                            ? active
                              ? 'bg-emerald-500/30 text-emerald-200'
                              : 'bg-emerald-50 text-emerald-700'
                            : active
                              ? 'bg-slate-700 text-slate-300'
                              : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {hit ? '已装' : '回退'}
                      </span>
                    )}
                  </div>
                  <div
                    className={`mt-1 truncate text-[12px] ${
                      active ? 'text-white' : 'text-slate-900'
                    }`}
                    style={{ fontFamily: FONT_STACKS[item.id] }}
                  >
                    物理教研 2026 · Abc
                  </div>
                  <div
                    className={`mt-0.5 truncate text-[10px] ${
                      active ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {item.desc}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">本机系统任意字体覆盖</span>
                {settings.customFontFamily && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-teal-700">
                    <Check size={10} /> 已覆盖：{settings.customFontFamily}
                  </span>
                )}
              </div>
              <select
                aria-label="本机任意字体覆盖"
                value={settings.customFontFamily ?? ''}
                onChange={(e) => patch('customFontFamily', e.target.value)}
                className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-slate-500 focus:outline-none"
              >
                <option value="">默认（使用上方 8 套精选方案）</option>
                <optgroup label="常用高质量中英文字体">
                  {RECOMMENDED_CJK_CUSTOM_FONTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                      {installedSet.size > 0 && !installedSet.has(f.value.toLowerCase())
                        ? '（未在本机检测到）'
                        : ''}
                    </option>
                  ))}
                </optgroup>
                {otherSystemFonts.length > 0 && (
                  <optgroup label={`本机全部已装字体 (${otherSystemFonts.length})`}>
                    {otherSystemFonts.map((fontName) => (
                      <option key={fontName} value={fontName}>
                        {fontName}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {fontSourceNote && <p className="text-[10px] text-slate-400">{fontSourceNote}</p>}
          </div>

          {/* Fine Typography Controls */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">标题字重</span>
              <div className="inline-flex overflow-hidden rounded border border-slate-200 bg-slate-50 p-0.5">
                {(
                  [
                    ['normal', '常规'],
                    ['semibold', '中粗'],
                    ['bold', '加粗'],
                  ] as const
                ).map(([w, label]) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => patch('headingWeight', w)}
                    className={`rounded px-2.5 py-0.5 text-[11px] font-medium transition ${
                      (settings.headingWeight ?? 'bold') === w
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between gap-3">
              <span className="text-slate-600">全局字距</span>
              <input
                type="range"
                aria-label="全局字距"
                min={-0.5}
                max={2}
                step={0.05}
                value={settings.letterSpacing ?? 0}
                onChange={(e) => patch('letterSpacing', Number(e.target.value))}
                className="flex-1 accent-slate-900"
              />
              <span className="w-12 text-right font-mono">
                {(settings.letterSpacing ?? 0).toFixed(2)}px
              </span>
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={settings.tabularNums !== false}
                onChange={(e) => patch('tabularNums', e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>数字与日期等宽对齐（tabular-nums）</span>
            </label>
          </div>
        </section>

        {/* Spacing & Typography Sliders */}
        <section className="space-y-2.5 border-t border-slate-100 pt-3">
          <div className="font-semibold text-slate-800">字号与间距精密微调</div>

          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-600">正文字号</span>
            <input
              type="range"
              min={DENSITY_LIMITS.baseFontSize.min}
              max={DENSITY_LIMITS.baseFontSize.max}
              step={DENSITY_LIMITS.baseFontSize.step}
              value={settings.baseFontSize}
              onChange={(e) => patch('baseFontSize', Number(e.target.value))}
              className="flex-1 accent-slate-900"
            />
            <span className="w-10 text-right font-mono">{settings.baseFontSize}px</span>
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-600">行高倍率</span>
            <input
              type="range"
              min={DENSITY_LIMITS.lineHeight.min}
              max={DENSITY_LIMITS.lineHeight.max}
              step={DENSITY_LIMITS.lineHeight.step}
              value={settings.lineHeight}
              onChange={(e) => patch('lineHeight', Number(e.target.value))}
              className="flex-1 accent-slate-900"
            />
            <span className="w-10 text-right font-mono">{settings.lineHeight.toFixed(2)}</span>
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-600">模块间距</span>
            <input
              type="range"
              min={DENSITY_LIMITS.sectionSpacing.min}
              max={DENSITY_LIMITS.sectionSpacing.max}
              step={DENSITY_LIMITS.sectionSpacing.step}
              value={settings.sectionSpacing}
              onChange={(e) => patch('sectionSpacing', Number(e.target.value))}
              className="flex-1 accent-slate-900"
            />
            <span className="w-10 text-right font-mono">{settings.sectionSpacing}px</span>
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-600">段落间距</span>
            <input
              type="range"
              min={DENSITY_LIMITS.paragraphSpacing.min}
              max={DENSITY_LIMITS.paragraphSpacing.max}
              step={1}
              value={settings.paragraphSpacing}
              onChange={(e) => patch('paragraphSpacing', Number(e.target.value))}
              className="flex-1 accent-slate-900"
            />
            <span className="w-10 text-right font-mono">{settings.paragraphSpacing}px</span>
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-600">页面边距</span>
            <input
              type="range"
              min={DENSITY_LIMITS.pagePadding.min}
              max={DENSITY_LIMITS.pagePadding.max}
              step={DENSITY_LIMITS.pagePadding.step}
              value={settings.pagePadding}
              onChange={(e) => patch('pagePadding', Number(e.target.value))}
              className="flex-1 accent-slate-900"
            />
            <span className="w-10 text-right font-mono">{settings.pagePadding}px</span>
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-600">标题字号</span>
            <input
              type="range"
              min={14}
              max={26}
              step={1}
              value={settings.headerSize}
              onChange={(e) => patch('headerSize', Number(e.target.value))}
              className="flex-1 accent-slate-900"
            />
            <span className="w-10 text-right font-mono">{settings.headerSize}px</span>
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-600">副标题字号</span>
            <input
              type="range"
              min={12}
              max={22}
              step={1}
              value={settings.subheaderSize}
              onChange={(e) => patch('subheaderSize', Number(e.target.value))}
              className="flex-1 accent-slate-900"
            />
            <span className="w-10 text-right font-mono">{settings.subheaderSize}px</span>
          </label>

          <div className="flex flex-col gap-2 pt-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={settings.useIconMode}
                onChange={(e) => patch('useIconMode', e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>显示基础信息图标</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={settings.showPageGuide}
                onChange={(e) => patch('showPageGuide', e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>显示 297mm 单页红线警戒标尺</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={settings.avoidItemSplit}
                onChange={(e) => patch('avoidItemSplit', e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>防单条经历跨页劈断（推荐开启）</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={settings.autoCjkSpacing}
                onChange={(e) => patch('autoCjkSpacing', e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>中英文与数字混排自动加空格（预览态无损生效）</span>
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
