import {
  APPLICATION_STATUS_META,
  type CoverLetterHeaderVariant,
  type JobApplication,
} from '../schema/applicationSchema';
import type { TemplateId } from '../schema/resumeSchema';

export interface ApplicationFunnelStats {
  total: number;
  wishlist: number;
  applied: number;
  written: number;
  interview: number;
  offer: number;
  closed: number;
  progressedRate: number;
  interviewRate: number;
  offerRate: number;
}

export const COVER_LETTER_VARIANT_LABELS: Record<CoverLetterHeaderVariant, string> = {
  'classic-line': '经典双线商函',
  'wave-banner': '波浪彩带页眉（配 VIP 模板）',
  'sidebar-accent': '左侧色条名片（配侧栏模板）',
  'academic-serif': '学院派居中衬线（配科研/经典模板）',
};

/**
 * 按主简历 `templateId` 智能映射相协调的自荐信页眉视觉风格。
 */
export function resolveCoverLetterHeaderVariant(
  templateId: TemplateId | string,
): CoverLetterHeaderVariant {
  if (
    templateId.includes('wave') ||
    templateId === 'vip-sky-notch-hero' ||
    templateId === 'vip-burgundy-center-hero' ||
    templateId === 'vip-crimson-ribbon-banner' ||
    templateId === 'vip-obsidian-gold-hero' ||
    templateId === 'vip-crimson-double-arc' ||
    templateId === 'vip-cyan-arc-trapezoid' ||
    templateId === 'wondercv-royal-banner' ||
    templateId === 'wondercv-diagonal-hero' ||
    templateId === 'edu-navy-ribbon'
  ) {
    return 'wave-banner';
  }
  if (
    templateId.includes('sidebar') ||
    templateId.includes('split') ||
    templateId.includes('flag') ||
    templateId === 'rx-azurill' ||
    templateId === 'rx-chikorita' ||
    templateId === 'json-macchiato' ||
    templateId === 'wondercv-soft-right'
  ) {
    return 'sidebar-accent';
  }
  if (
    templateId.includes('serif') ||
    templateId.includes('academic') ||
    templateId === 'modern-deedy' ||
    templateId === 'double-line-scholar'
  ) {
    return 'academic-serif';
  }
  return 'classic-line';
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

/**
 * 导出兼容 Excel（UTF-8 BOM `\uFEFF`）的 RFC 4180 标准投递台账 CSV。
 */
export function buildApplicationsCsv(applications: readonly JobApplication[]): string {
  const headers = [
    '单位/学校',
    '投递岗位',
    '当前状态',
    '投递日期',
    '城市',
    '薪资/编制',
    'ATS机读分',
    '关联简历版本',
    '面试时间',
    '面试地点',
    '导出PDF路径',
    '复盘备注',
  ];
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const app of applications) {
    lines.push(
      [
        app.company,
        app.role,
        APPLICATION_STATUS_META[app.status]?.label ?? app.status,
        app.appliedDate,
        app.city,
        app.salary,
        app.atsScore ?? '',
        app.resumeSlug,
        app.interviewAt,
        app.interviewLocation,
        app.exportedFilePath,
        app.notes,
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function formatIcsLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatIcsUtcStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate(),
  )}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\n')
    .replaceAll('\n', '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

function parseInterviewDate(raw: string): Date {
  const trimmed = raw.trim();
  if (trimmed) {
    const normalized = trimmed.replace(/\//g, '-').replace(' ', 'T');
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  const fallback = new Date(Date.now() + 24 * 60 * 60 * 1000);
  fallback.setHours(9, 30, 0, 0);
  return fallback;
}

/**
 * 生成 RFC 5545 标准 `.ics` 面试日程文件（含提前 30 分钟 `VALARM` 提醒与 `\r\n` 换行）。
 */
export function buildInterviewIcs(app: JobApplication): string {
  const start = parseInterviewDate(app.interviewAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const summary = `面试：${app.company || '目标单位'} - ${app.role || '目标岗位'}`;
  const descParts = [
    `应聘单位：${app.company || '未填写'}`,
    `应聘岗位：${app.role || '未填写'}`,
    app.resumeSlug ? `关联简历版本：${app.resumeSlug}` : '',
    app.notes ? `复盘/注意事项：${app.notes}` : '',
  ].filter(Boolean);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Resume Studio//Interview Calendar//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:resume-studio-${app.id}@local`,
    `DTSTAMP:${formatIcsUtcStamp(new Date())}`,
    `DTSTART:${formatIcsLocalDateTime(start)}`,
    `DTEND:${formatIcsLocalDateTime(end)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    ...(app.interviewLocation.trim()
      ? [`LOCATION:${escapeIcsText(app.interviewLocation.trim())}`]
      : []),
    `DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(`30分钟后开始：${summary}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * 计算求职投递 5 阶段人数分布及零分母安全转化率。
 */
export function computeApplicationFunnel(
  applications: readonly JobApplication[],
): ApplicationFunnelStats {
  const counts = {
    wishlist: 0,
    applied: 0,
    written: 0,
    interview: 0,
    offer: 0,
    closed: 0,
  };
  for (const app of applications) {
    counts[app.status] += 1;
  }
  const activeBase = applications.length;
  const progressed = counts.written + counts.interview + counts.offer;
  const reachedInterview = counts.interview + counts.offer;
  return {
    total: activeBase,
    ...counts,
    progressedRate: activeBase > 0 ? Math.round((progressed / activeBase) * 100) : 0,
    interviewRate: activeBase > 0 ? Math.round((reachedInterview / activeBase) * 100) : 0,
    offerRate: activeBase > 0 ? Math.round((counts.offer / activeBase) * 100) : 0,
  };
}
