import { describe, expect, it } from 'vitest';
import { getLocaleLabels, switchDocumentLocale } from './resumeLocale';
import { ResumeDocumentSchema } from '../schema/resumeSchema';

describe('resumeLocale', () => {
  it('returns proper localization labels for zh-CN and en-US', () => {
    expect(getLocaleLabels('zh-CN').targetRole).toBe('求职意向：');
    expect(getLocaleLabels('en-US').targetRole).toBe('Target Role: ');
    expect(getLocaleLabels('en-US').link).toBe('Link');
  });

  it('translates standard section titles and field labels while preserving custom titles', () => {
    const doc = ResumeDocumentSchema.parse({
      id: 'loc-1',
      title: '测试',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      basic: { name: '张甲', title: 'Physics Teacher' },
      menuSections: [
        { id: 'basic', title: '基本信息', order: 0 },
        { id: 'education', title: '教育经历', order: 1 },
        { id: 'experience', title: '工作经历', order: 2 },
        { id: 'projects', title: '项目经历', order: 3 },
        { id: 'skills', title: '专业技能', order: 4 },
        { id: 'custom-special', title: '我的独特竞赛', order: 5 },
      ],
      globalSettings: { autoCjkSpacing: true },
    });

    const enDoc = switchDocumentLocale(doc, 'en-US');
    expect(enDoc.globalSettings.locale).toBe('en-US');
    expect(enDoc.globalSettings.autoCjkSpacing).toBe(false);
    expect(enDoc.menuSections.map((s) => s.title)).toEqual([
      'Basic Info',
      'Education',
      'Experience',
      'Projects',
      'Skills',
      '我的独特竞赛',
    ]);
    expect(enDoc.basic.fieldOrder.find((f) => f.key === 'email')?.label).toBe('Email');

    const backZh = switchDocumentLocale(enDoc, 'zh-CN');
    expect(backZh.globalSettings.locale).toBe('zh-CN');
    expect(backZh.menuSections.map((s) => s.title)).toEqual([
      '基本信息',
      '教育经历',
      '工作经历',
      '项目经历',
      '专业技能',
      '我的独特竞赛',
    ]);
    expect(backZh.basic.fieldOrder.find((f) => f.key === 'email')?.label).toBe('邮箱');
  });
});
