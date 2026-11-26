import { useCallback, useRef, useState, type RefObject } from 'react';
import type { FrozenPdfExportSnapshot } from '../components/Career/QuickLogApplicationModal';
import { apiClient } from '../lib/apiClient';
import { buildResumeExportStem } from '../lib/resumeExportNaming';
import { exportToJsonResume } from '../lib/jsonResumeAdapter';
import { parseCustomRedactionTerms, redactResumeDocument } from '../lib/privacyRedactor';
import type { ResumeDocument } from '../schema/resumeSchema';

export type ExportFormat =
  | 'pdf'
  | 'png'
  | 'docx'
  | 'markdown'
  | 'html'
  | 'json'
  | 'jsonResume';

export interface ExportStatusState {
  type: 'ok' | 'error';
  text: string;
  filePath?: string;
}

interface UseResumeExportOptions {
  activeSlug: string;
  activeDocRef: RefObject<ResumeDocument | null>;
  flushPendingSave: () => Promise<void>;
  isRedacted: boolean;
  redactionTermsInput: string;
}

export function useResumeExport({
  activeSlug,
  activeDocRef,
  flushPendingSave,
  isRedacted,
  redactionTermsInput,
}: UseResumeExportOptions) {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportInFlight = useRef(false);
  const [exportStatus, setExportStatus] = useState<ExportStatusState | null>(null);
  const [lastExportedPdfSnapshot, setLastExportedPdfSnapshot] =
    useState<FrozenPdfExportSnapshot | null>(null);

  const handleExportFormat = useCallback(
    async (format: ExportFormat, saveAs = false) => {
      const latest = activeDocRef.current;
      if (!latest || exportInFlight.current) return;
      exportInFlight.current = true;
      setIsExportMenuOpen(false);
      setIsExporting(true);
      setExportStatus(null);
      try {
        await flushPendingSave();
        const savedRealDoc = activeDocRef.current ?? latest;
        const customTerms = parseCustomRedactionTerms(redactionTermsInput);
        const docToExport = isRedacted
          ? redactResumeDocument(savedRealDoc, {
              hideName: true,
              maskPhone: true,
              maskEmail: true,
              hidePhoto: true,
              customTerms,
            })
          : savedRealDoc;
        const suffix = isRedacted ? '-脱敏版' : '';

        if (format === 'json') {
          const blob = new Blob([`${JSON.stringify(docToExport, null, 2)}\n`], {
            type: 'application/json;charset=utf-8',
          });
          const url = URL.createObjectURL(blob);
          const a = window.document.createElement('a');
          a.href = url;
          a.download = `${activeSlug || 'resume'}${suffix}.json`;
          a.click();
          URL.revokeObjectURL(url);
          setExportStatus({ type: 'ok', text: `已导出 JSON 备份：${a.download}` });
          return;
        }

        if (format === 'jsonResume') {
          const jrText = `${JSON.stringify(exportToJsonResume(docToExport), null, 2)}\n`;
          const jrRes = await apiClient.saveTextFile({
            defaultFileName: `${buildResumeExportStem(docToExport, suffix)}-jsonresume.json`,
            content: jrText,
            extension: 'json',
            filterName: 'JSON Resume 文件',
            dialogTitle: '导出标准 JSON Resume（仅可见内容）',
            mimeType: 'application/json;charset=utf-8',
            saveAs,
          });
          setLastExportedPdfSnapshot(null);
          if (!jrRes.canceled) {
            setExportStatus({
              type: 'ok',
              text: `已导出标准 JSON Resume（仅可见内容；非完整备份）${suffix}：${jrRes.filePath ?? jrRes.fileName}`,
              filePath: jrRes.filePath,
            });
          }
          return;
        }

        const opts = {
          slug: activeSlug,
          document: docToExport,
          saveAs,
          skipSave: isRedacted,
          fileNameSuffix: suffix || undefined,
        };
        const result =
          format === 'pdf'
            ? await apiClient.exportPdf(opts)
            : format === 'png'
              ? await apiClient.exportPng(opts)
              : format === 'docx'
                ? await apiClient.exportDocx(opts)
                : format === 'html'
                  ? await apiClient.exportHtml(opts)
                  : await apiClient.exportMarkdown(opts);

        if (result.canceled) return;

        const formatLabel =
          format === 'pdf'
            ? isRedacted
              ? '矢量 A4 PDF（脱敏版）'
              : '矢量 A4 PDF'
            : format === 'png'
              ? isRedacted
                ? '高清 2x PNG 长图（脱敏版）'
                : '高清 2x PNG 长图'
              : format === 'docx'
                ? isRedacted
                  ? 'Word 文档 (.docx 脱敏版)'
                  : 'Word 文档 (.docx)'
                : format === 'html'
                  ? isRedacted
                    ? '离线网页主页 (.html 脱敏版)'
                    : '离线网页主页 (.html)'
                  : isRedacted
                    ? 'Markdown (.md 脱敏版)'
                    : 'Markdown 文档 (.md)';

        if (result.filePath) {
          if (format === 'pdf') {
            setLastExportedPdfSnapshot({
              slug: activeSlug,
              filePath: result.filePath,
              document: structuredClone(savedRealDoc),
              isRedacted,
            });
          } else {
            setLastExportedPdfSnapshot(null);
          }
          setExportStatus({
            type: 'ok',
            text: `已导出${formatLabel}：${result.filePath}`,
            filePath: result.filePath,
          });
        } else if (result.fileName) {
          setLastExportedPdfSnapshot(null);
          setExportStatus({
            type: 'ok',
            text: `已生成${formatLabel}：${result.fileName}`,
          });
        }
      } catch (err) {
        setExportStatus({
          type: 'error',
          text: err instanceof Error ? err.message : '导出文件失败',
        });
      } finally {
        exportInFlight.current = false;
        setIsExporting(false);
      }
    },
    [activeDocRef, activeSlug, flushPendingSave, isRedacted, redactionTermsInput],
  );

  return {
    isExportMenuOpen,
    setIsExportMenuOpen,
    isExporting,
    exportStatus,
    setExportStatus,
    lastExportedPdfSnapshot,
    setLastExportedPdfSnapshot,
    handleExportFormat,
  };
}
