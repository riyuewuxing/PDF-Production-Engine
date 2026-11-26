import { describe, expect, it } from 'vitest';
import { buildStandaloneResumeHtml } from './htmlExporter';
import { ResumeDocumentSchema } from '../schema/resumeSchema';

describe('htmlExporter', () => {
  it('builds self-contained offline HTML without external CDNs while escaping XSS payloads', () => {
    const doc = ResumeDocumentSchema.parse({
      id: 'html-1',
      title: '测试简历',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      basic: {
        name: '测试员<script>alert(1)</script>',
        title: '高中物理教师',
        email: 'demo@example.invalid',
        photoConfig: { visible: true },
      },
      menuSections: [
        { id: 'basic', title: '基本信息', order: 0 },
        { id: 'experience', title: '工作经历', order: 1 },
        { id: 'skills', title: '专业技能', order: 2 },
      ],
      experience: [
        {
          id: 'e1',
          company: '示例中学',
          description: '- 带教成效：粒子能量满足 E < 10 MeV 与 **重要结论**',
        },
      ],
      skillContent: '- Python 可视化 <img src=x onerror=alert(2)>',
      globalSettings: { themeColor: '#167883', locale: 'zh-CN' },
    });

    const html = buildStandaloneResumeHtml(doc, {
      embeddedPhotoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('E &lt; 10 MeV');
    expect(html).toContain('<strong>重要结论</strong>');
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
  });
});
