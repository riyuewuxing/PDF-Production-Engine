import { describe, expect, it } from 'vitest';
import {
  buildApplicationsCsv,
  buildInterviewIcs,
  computeApplicationFunnel,
  resolveCoverLetterHeaderVariant,
} from './careerExporter';
import type { JobApplication } from '../schema/applicationSchema';

function sampleApp(overrides: Partial<JobApplication> = {}): JobApplication {
  return {
    id: 'app-1',
    company: '云南师大附中',
    role: '高中物理教师',
    city: '昆明',
    salary: '编内',
    resumeSlug: 'physics-teacher-yunnan',
    status: 'interview',
    appliedDate: '2026-11-20',
    notes: '准备试讲，带实验器材演示',
    jdText: '',
    snapshotId: 'snap-1',
    exportedFilePath: 'D:\\exports\\resume.pdf',
    interviewAt: '2026-11-25 14:30',
    interviewLocation: '主楼 302 室',
    atsScore: 95,
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('careerExporter', () => {
  it('maps resume templates cleanly across all 4 cover letter header variants', () => {
    expect(resolveCoverLetterHeaderVariant('vip-sky-notch-hero')).toBe('wave-banner');
    expect(resolveCoverLetterHeaderVariant('vip-obsidian-gold-hero')).toBe('wave-banner');
    expect(resolveCoverLetterHeaderVariant('vip-crimson-ribbon-banner')).toBe('wave-banner');
    expect(resolveCoverLetterHeaderVariant('wondercv-royal-banner')).toBe('wave-banner');
    expect(resolveCoverLetterHeaderVariant('wondercv-teal-sidebar')).toBe('sidebar-accent');
    expect(resolveCoverLetterHeaderVariant('vip-teal-right-flag')).toBe('sidebar-accent');
    expect(resolveCoverLetterHeaderVariant('classic-serif')).toBe('academic-serif');
    expect(resolveCoverLetterHeaderVariant('harvard-academic')).toBe('academic-serif');
    expect(resolveCoverLetterHeaderVariant('double-line-scholar')).toBe('academic-serif');
    expect(resolveCoverLetterHeaderVariant('minimal-ats')).toBe('classic-line');
  });

  it('builds UTF-8 BOM CSV with RFC 4180 escaping for quotes, commas, and newlines', () => {
    const csv = buildApplicationsCsv([
      sampleApp({
        company: '昆明一中, "本部"',
        notes: '第一行\n第二行',
      }),
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('单位/学校,投递岗位,当前状态');
    expect(csv).toContain('"昆明一中, ""本部"""');
    expect(csv).toContain('"第一行\n第二行"');
    expect(csv).toContain('面试中');
  });

  it('neutralizes spreadsheet formulas including leading whitespace and control characters',()=>{
    const csv=buildApplicationsCsv([sampleApp({company:'=1+1',role:'  +1',city:'\t@SUM(A1)',salary:'－1',notes:'\r\n=2+2',atsScore:95})]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'  +1");
    expect(csv).toContain("'\t@SUM(A1)");
    expect(csv).toContain("'－1");
    expect(csv).toContain("\"'\r\n=2+2\"");
    expect(csv).toContain(',95,');
    const safe=buildApplicationsCsv([sampleApp({company:'示例学校',notes:'普通备注',salary:'12-15k'})]);
    expect(safe).toContain('示例学校');
    expect(safe).toContain('12-15k');
    expect(safe).not.toContain("'普通备注");
  });

  it('builds RFC 5545 standard .ics with CRLF line endings and 30-min VALARM', () => {
    const ics = buildInterviewIcs(sampleApp());
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('DTSTART:20261125T143000\r\n');
    expect(ics).toContain('DTEND:20261125T153000\r\n');
    expect(ics).toContain('LOCATION:主楼 302 室\r\n');
    expect(ics).toContain('BEGIN:VALARM\r\nTRIGGER:-PT30M\r\n');
    expect(ics).toContain('END:VCALENDAR\r\n');
  });

  it('computes 5-stage funnel stats safely including zero-denominator case', () => {
    const empty = computeApplicationFunnel([]);
    expect(empty.total).toBe(0);
    expect(empty.progressedRate).toBe(0);
    expect(empty.offerRate).toBe(0);

    const funnel = computeApplicationFunnel([
      sampleApp({ id: '1', status: 'applied' }),
      sampleApp({ id: '2', status: 'written' }),
      sampleApp({ id: '3', status: 'interview' }),
      sampleApp({ id: '4', status: 'offer' }),
    ]);
    expect(funnel.total).toBe(4);
    expect(funnel.applied).toBe(1);
    expect(funnel.written).toBe(1);
    expect(funnel.interview).toBe(1);
    expect(funnel.offer).toBe(1);
    expect(funnel.progressedRate).toBe(75);
    expect(funnel.interviewRate).toBe(50);
    expect(funnel.offerRate).toBe(25);
  });
});
