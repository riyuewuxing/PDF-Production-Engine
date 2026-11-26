import type { ResumeDocument } from '../schema/resumeSchema';
import { visibleBasicValue } from './resumeVisibility';

export function sanitizeFilePart(value: string, fallback: string): string {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/\s+/g, '') || fallback;
}

export function formatLocalDate(now = new Date()): string {
  return String(now.getFullYear())+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
}

export function buildResumeExportStem(doc: ResumeDocument, suffix = '', now = new Date()): string {
  const rawName = visibleBasicValue(doc,'name').trim();
  const name = rawName && rawName !== '[姓名]' ? sanitizeFilePart(rawName,'简历') : '个人简历';
  const role = sanitizeFilePart(visibleBasicValue(doc,'title'),'求职简历');
  return name+'-'+role+'-'+formatLocalDate(now)+sanitizeFilePart(suffix,'');
}

export function buildResumeExportFilename(doc: ResumeDocument, ext: 'pdf'|'png'|'docx'|'md'|'html', suffix = '', now = new Date()): string {
  return buildResumeExportStem(doc,suffix,now)+'.'+ext;
}

let finishPendingPrint: (()=>void) | undefined;

/** Browser print titles must never be derived from the private version slug/title. */
export function printResumeInBrowser(doc: ResumeDocument, suffix = ''): void {
  finishPendingPrint?.();
  const originalTitle = window.document.title;
  const printTitle = buildResumeExportStem(doc,suffix);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (finishPendingPrint !== finish) return;
    finishPendingPrint = undefined;
    if (timer !== undefined) clearTimeout(timer);
    window.removeEventListener('afterprint',finish);
    if (window.document.title === printTitle) window.document.title = originalTitle;
  };
  finishPendingPrint = finish;
  window.document.title = printTitle;
  window.addEventListener('afterprint',finish);
  // Standard browsers dispatch afterprint when the dialog closes; bounded
  // fallback handles engines that fail to dispatch it.
  timer = setTimeout(finish,60000);
  try { window.print(); } catch (error) { finish(); throw error; }
}
