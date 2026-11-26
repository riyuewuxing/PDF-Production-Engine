import { describe, expect, it } from 'vitest';
import { applyBlockUpdates, collectEditableBlocks } from './resumeBlocks';
import { ResumeDocumentSchema } from '../schema/resumeSchema';

function buildSampleDoc() {
  return ResumeDocumentSchema.parse({
    id: 'doc-blocks',
    title: '测试简历',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    basic: { name: '张甲', title: '物理教师' },
    education: [
      { id: 'edu-1', school: '示例大学', description: '量子物理主修' },
      { id: 'edu-hidden', school: '隐藏', visible: false, description: '不应出现' },
    ],
    experience: [{ id: 'exp-1', company: '示例中学', description: '高二物理教学' }],
    projects: [{ id: 'proj-1', name: '电磁仿真', description: '开发交互课件' }],
    menuSections: [
      { id: 'education', title: '教育经历', order: 0 },
      { id: 'experience', title: '工作经历', order: 1 },
      { id: 'projects', title: '项目经历', order: 2 },
      { id: 'skills', title: '专业技能', order: 3 },
      { id: 'custom-honors', title: '荣誉奖项', order: 4 },
      { id: 'selfEvaluation', title: '自我评价', order: 5 },
    ],
    customData: {
      'custom-honors': [{ id: 'h-1', title: '一等奖学金', description: '前 5%' }],
    },
    skillContent: '物理教师资格证',
    selfEvaluationContent: '热爱物理教育',
    globalSettings: {},
  });
}

describe('resumeBlocks', () => {
  it('collects visible education, experience, projects, customData, skills, and selfEvaluation blocks', () => {
    const blocks = collectEditableBlocks(buildSampleDoc());
    const keys = blocks.map((b) => b.key);
    expect(keys).toEqual([
      'edu:edu-1',
      'exp:exp-1',
      'proj:proj-1',
      'custom:custom-honors:h-1',
      'skills',
      'selfEvaluation',
    ]);
    expect(blocks.every((b) => b.maxCharsHint >= 80)).toBe(true);
  });

  it('does not include blocks in disabled or missing sections', () => {
    const doc = buildSampleDoc();
    doc.menuSections = doc.menuSections
      .filter((s) => s.id !== 'skills')
      .map((s) => ({ ...s, enabled: !['education', 'custom-honors', 'selfEvaluation'].includes(s.id) }));
    expect(collectEditableBlocks(doc).map((b) => b.key)).toEqual(['exp:exp-1', 'proj:proj-1']);
  });

  it('applies batch updates immutably without mutating original document', () => {
    const original = buildSampleDoc();
    const updated = applyBlockUpdates(original, {
      'edu:edu-1': '参与合成项目两年',
      'exp:exp-1': '带教高二三班，均分提升 10%',
      'custom:custom-honors:h-1': '连续三年校级一等奖学金',
      skills: 'Python / 高中物理教资',
    });

    expect(updated).not.toBe(original);
    expect(original.education[0]?.description).toBe('量子物理主修');
    expect(updated.education[0]?.description).toBe('参与合成项目两年');
    expect(updated.experience[0]?.description).toBe('带教高二三班，均分提升 10%');
    expect(updated.customData['custom-honors']?.[0]?.description).toBe('连续三年校级一等奖学金');
    expect(updated.skillContent).toBe('Python / 高中物理教资');
    expect(updated.selfEvaluationContent).toBe('热爱物理教育');
  });
});
