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
  type: 'ok' | 'warn' | 'error';
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
  const versionGeneration=useRef(0);
  const [exportStatus, setExportStatus] = useState<ExportStatusState | null>(null);
  const [lastExportedPdfSnapshot, setLastExportedPdfSnapshot] =
    useState<FrozenPdfExportSnapshot | null>(null);

  const invalidateExportFeedback=useCallback(()=>{
    versionGeneration.current++;
    setExportStatus(null);
    setLastExportedPdfSnapshot(null);
  },[]);

  const handleExportFormat = useCallback(
    async (format: ExportFormat, saveAs = false) => {
      const latest = activeDocRef.current;
      if (!latest || exportInFlight.current) return;
      exportInFlight.current = true;
      const generation=versionGeneration.current;
      const sameVersion=()=>versionGeneration.current===generation&&activeDocRef.current?.id===latest.id;
      setLastExportedPdfSnapshot(null);
      setIsExportMenuOpen(false);
      setIsExporting(true);
      setExportStatus(null);
      try {
        await flushPendingSave();
        if(!sameVersion())return;
        const savedRealDoc = structuredClone(activeDocRef.current ?? latest);
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
          a.download = isRedacted ? `${buildResumeExportStem(docToExport,suffix)}.json` : `${activeSlug || 'resume'}.json`;
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
              type: sameVersion()?'ok':'warn',
              text: `已导出标准 JSON Resume（仅可见内容；非完整备份）${suffix}：${jrRes.filePath ?? jrRes.fileName}${sameVersion()?'':'。文件属于此前版本。'}`,
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
          if(!sameVersion()||result.snapshotWarning){
            setLastExportedPdfSnapshot(null);
            setExportStatus({
              type:'warn',filePath:result.filePath,
              text:`已导出${formatLabel}：${result.filePath}。${!sameVersion()?'文件属于此前版本，未关联当前简历。':''}${result.snapshotWarning?'自动历史快照未确认完成：'+result.snapshotWarning:''}`,
            });
            return;
          }
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
            type: sameVersion()?'ok':'warn',
            text: `已生成${formatLabel}：${result.fileName}${sameVersion()?'':'。文件属于此前版本。'}`,
          });
        }
      } catch (err) {
        if(!sameVersion())return;
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
    invalidateExportFeedback,
    handleExportFormat,
  };
}
