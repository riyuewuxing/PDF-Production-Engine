import { useEffect, useRef, useState } from 'react';
import type { ResumeDocument } from '../../schema/resumeSchema';
import { getTemplateMetadata } from '../../templates/registry';

export function PrintDocumentView({ jobId }: { jobId: string }) {
  const [doc, setDoc] = useState<ResumeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPayload() {
      try {
        if (!window.resumeDesktop) {
          throw new Error('缺少 Electron 桌面打印通道');
        }
        const payload = await window.resumeDesktop.pdf.getPrintPayload(jobId);
        if (!cancelled) {
          setDoc(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载打印数据失败');
        }
      }
    }
    void loadPayload();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    async function waitAndNotifyReady() {
      try {
        if (window.document.fonts?.ready) {
          await window.document.fonts.ready;
        }
        const rootEl = containerRef.current;
        if (rootEl) {
          const images = Array.from(rootEl.querySelectorAll('img'));
          await Promise.all(
            images.map((img) => {
              if (img.complete) return Promise.resolve();
              return new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, 4000);
                const done = () => {
                  clearTimeout(timer);
                  resolve();
                };
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
              });
            }),
          );
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (!cancelled) {
          // Measure only after fonts/images settle at the A4 print viewport.
          // 297mm less the 2 x 16pt continuation margins in print.css.
          const continuationHeight = 297 * 96 / 25.4 - 32 * 96 / 72;
          rootEl?.querySelectorAll<HTMLElement>('.resume-item-block').forEach((item) => {
            item.classList.toggle(
              'resume-print-oversize-item',
              item.getBoundingClientRect().height > continuationHeight,
            );
          });
          await window.resumeDesktop?.pdf.notifyReady(jobId);
        }
      } catch {
        if (!cancelled) {
          await window.resumeDesktop?.pdf.notifyReady(jobId);
        }
      }
    }

    void waitAndNotifyReady();
    return () => {
      cancelled = true;
    };
  }, [doc, jobId]);

  if (error) {
    return <div className="p-8 text-sm text-red-600">{error}</div>;
  }

  if (!doc) {
    return <div className="p-8 text-sm text-slate-500">正在准备打印版式...</div>;
  }

  const TemplateComponent = getTemplateMetadata(doc.templateId).component;
  const sheetBg =
    doc.templateId === 'vip-cyber-dark'
      ? '#0b1220'
      : doc.globalSettings.paperBackground || '#ffffff';

  return (
    <div ref={containerRef} className="resume-print-root" style={{ backgroundColor: sheetBg }}>
      <div className="a4-sheet" style={{ backgroundColor: sheetBg }}>
        <TemplateComponent document={doc} />
      </div>
    </div>
  );
}
