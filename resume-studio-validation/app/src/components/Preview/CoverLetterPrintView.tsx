import { useEffect, useState } from 'react';
import type { CoverLetterPdfPayload } from '../../schema/applicationSchema';
import type { GlobalSettings } from '../../schema/resumeSchema';
import { FONT_STACKS, darkenHex, mixWithWhite } from '../../templates/shared';

export function CoverLetterPrintView({ jobId }: { jobId: string }) {
  const [payload, setPayload] = useState<CoverLetterPdfPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!window.resumeDesktop) {
          throw new Error('缺少 Electron 桌面打印通道');
        }
        const data = await window.resumeDesktop.pdf.getCoverLetterPayload(jobId);
        if (!cancelled) setPayload(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载自荐信数据失败');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    async function notify() {
      try {
        if (window.document.fonts?.ready) {
          await window.document.fonts.ready;
        }
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      } finally {
        if (!cancelled) {
          await window.resumeDesktop?.pdf.notifyReady(jobId);
        }
      }
    }
    void notify();
    return () => {
      cancelled = true;
    };
  }, [jobId, payload]);

  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!payload) return <div className="p-8 text-sm text-slate-500">正在准备自荐信版式...</div>;

  const baseStack =
    FONT_STACKS[(payload.fontFamily as GlobalSettings['fontFamily']) ?? 'sans'] ?? FONT_STACKS.sans;
  const customFont = payload.customFontFamily?.trim().replace(/["\\]/g, '');
  const resolvedFont = customFont ? `"${customFont}", ${baseStack}` : baseStack;
  const accent = payload.themeColor || '#167883';
  const variant = payload.headerVariant ?? 'classic-line';
  const paragraphs = payload.bodyText.split(/\n{2,}/);
  const dateText = payload.dateText || new Date().toISOString().slice(0, 10);

  if (variant === 'wave-banner') {
    const deepAccent = darkenHex(accent, 0.25);
    return (
      <div
        className="a4-sheet overflow-hidden bg-white text-slate-900"
        style={{ fontFamily: resolvedFont, fontSize: '14.5px', lineHeight: 1.72 }}
      >
        <header
          className="relative px-12 pt-9 pb-12 text-white"
          style={{
            backgroundColor: accent,
            backgroundImage: `linear-gradient(135deg, ${accent} 0%, ${deepAccent} 100%)`,
          }}
        >
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{payload.title || '求职自荐信'}</h1>
              <div className="mt-1.5 text-sm text-white/90">
                {payload.candidateName}
                {payload.candidateTitle ? ` · ${payload.candidateTitle}` : ''}
              </div>
            </div>
            <div className="text-right text-xs text-white/85">
              {payload.company ? <div>致：{payload.company}</div> : null}
              <div className="mt-1">应聘岗位：{payload.role || '目标岗位'}</div>
            </div>
          </div>
          {payload.contactLine && (
            <div className="mt-3 text-xs text-white/85">{payload.contactLine}</div>
          )}
          <svg
            aria-hidden="true"
            viewBox="0 0 1440 90"
            preserveAspectRatio="none"
            className="absolute right-0 bottom-0 left-0 h-7 w-full"
          >
            <path
              d="M0,42 C340,95 1080,0 1440,56 L1440,90 L0,90 Z"
              fill="#ffffff"
            />
          </svg>
        </header>

        <main className="space-y-4 px-12 pt-5 pb-12 text-slate-800">
          {paragraphs.map((para, idx) => (
            <p key={idx} className="whitespace-pre-wrap">
              {para}
            </p>
          ))}
          <div className="pt-4 text-right text-xs text-slate-400">{dateText}</div>
        </main>
      </div>
    );
  }

  if (variant === 'sidebar-accent') {
    const paleTint = mixWithWhite(accent, 0.92);
    return (
      <div
        className="a4-sheet relative flex min-h-[297mm] bg-white text-slate-900"
        style={{ fontFamily: resolvedFont, fontSize: '14.2px', lineHeight: 1.72 }}
      >
        <div
          aria-hidden="true"
          className="w-3 shrink-0"
          style={{ backgroundColor: accent }}
        />
        <div className="flex-1 px-11 py-10">
          <header
            className="mb-7 rounded-r-lg border-l-4 px-5 py-4"
            style={{ backgroundColor: paleTint, borderColor: accent }}
          >
            <div className="flex items-baseline justify-between gap-4">
              <h1 className="text-xl font-bold tracking-tight" style={{ color: accent }}>
                {payload.title || '求职自荐信'}
              </h1>
              <span className="text-xs font-medium text-slate-500">{dateText}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
              <span>
                应聘岗位：<strong className="text-slate-950">{payload.role || '目标岗位'}</strong>
                {payload.company ? `（${payload.company}）` : ''}
              </span>
              {payload.contactLine && <span>{payload.contactLine}</span>}
            </div>
          </header>

          <main className="space-y-4 text-slate-800">
            {paragraphs.map((para, idx) => (
              <p key={idx} className="whitespace-pre-wrap">
                {para}
              </p>
            ))}
          </main>
        </div>
      </div>
    );
  }

  if (variant === 'academic-serif') {
    return (
      <div
        className="a4-sheet bg-white text-slate-900"
        style={{
          fontFamily: resolvedFont,
          padding: '44px 52px',
          fontSize: '14.5px',
          lineHeight: 1.75,
        }}
      >
        <header className="mb-8 border-y-2 py-4 text-center" style={{ borderColor: accent }}>
          <h1 className="text-2xl font-bold tracking-wide text-slate-950">
            {payload.title || '求职自荐信'}
          </h1>
          <div className="mt-1.5 text-sm font-medium" style={{ color: accent }}>
            {payload.company ? `敬呈 ${payload.company} · ` : ''}
            应聘：{payload.role || '目标岗位'}
          </div>
          {payload.contactLine && (
            <div className="mt-1.5 text-xs text-slate-600">{payload.contactLine}</div>
          )}
        </header>

        <main className="space-y-4 text-slate-800">
          {paragraphs.map((para, idx) => (
            <p key={idx} className="whitespace-pre-wrap">
              {para}
            </p>
          ))}
          <div className="pt-4 text-right text-xs text-slate-500">{dateText}</div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="a4-sheet bg-white text-slate-900"
      style={{
        fontFamily: resolvedFont,
        padding: '44px 48px',
        fontSize: '14.5px',
        lineHeight: 1.72,
      }}
    >
      <header className="mb-8 border-b-2 pb-4" style={{ borderColor: accent }}>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: accent }}>
            {payload.title || '求职自荐信'}
          </h1>
          <span className="text-sm font-medium text-slate-500">
            {payload.company ? `致：${payload.company}` : ''}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            应聘岗位：<strong className="text-slate-900">{payload.role || '目标岗位'}</strong>
          </span>
          {payload.contactLine && <span>{payload.contactLine}</span>}
        </div>
      </header>

      <main className="space-y-4 text-slate-800">
        {paragraphs.map((para, idx) => (
          <p key={idx} className="whitespace-pre-wrap">
            {para}
          </p>
        ))}
        <div className="pt-4 text-right text-xs text-slate-400">{dateText}</div>
      </main>
    </div>
  );
}
