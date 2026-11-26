import { describe, expect, it } from 'vitest';
import { scanFactGuardWarnings, parseTailorProposalsResponse, buildTrustedFactCorpus } from './aiTailor';
import { collectEditableBlocks } from './resumeBlocks';
import { ResumeDocumentSchema } from '../schema/resumeSchema';
const fixture = () => ResumeDocumentSchema.parse({"schemaVersion":1,"id":"demo-fixture-resume","title":"合成测试简历","templateId":"minimal-ats","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","activeSection":"basic","basic":{"name":"演示候选人","title":"示例岗位","email":"demo@example.invalid","phone":"","location":"示例城市","employmentStatus":"应届示例","photo":""},"menuSections":[{"id":"basic","title":"基本信息","order":0},{"id":"education","title":"教育经历","order":1},{"id":"experience","title":"工作经历","order":2},{"id":"projects","title":"项目经历","order":3},{"id":"skills","title":"专业技能","order":4},{"id":"selfEvaluation","title":"自我评价","order":5}],"education":[{"id":"edu-demo","school":"示例大学","major":"科学教育","degree":"硕士","startDate":"2022.09","endDate":"2025.06","description":"- 设计实验与记录实验结果。"}],"experience":[{"id":"exp-demo","company":"示例机构","position":"教学助理","startDate":"2025.09","endDate":"2026.06","description":"- 协助组织30课时的教学活动。"}],"projects":[{"id":"proj-demo","name":"示例课程工具","role":"成员","date":"2025.04","description":"- 制作实验演示材料并整理使用说明。"}],"skillContent":"- 实验设计、数据整理与沟通","selfEvaluationContent":"重视实验记录与清晰表达。","globalSettings":{"themeColor":"#167883","baseFontSize":13,"sectionSpacing":15,"paragraphSpacing":8,"pagePadding":28}});
describe('V6 synthetic guard regression', () => {
  it('does not accept a known number in a different unit or a numeric substring', () => {
    const warnings = scanFactGuardWarnings('提高30%，25项，GPA 3.2', '完成30课时，2025年，GPA 3.29');
    expect(warnings.map(w => w.token)).toEqual(expect.arrayContaining(['30%', '25项', '3.2']));
    expect(scanFactGuardWarnings('完成30课时，达标率96%', '完成 30 课时，达标率 96 %')).toEqual([]);
  });
  it('does not expose blocks in disabled or absent sections', () => {
    const doc = fixture();
    doc.menuSections = doc.menuSections.filter(s => s.id !== 'skills').map(s => ({ ...s, enabled: !['education', 'selfEvaluation'].includes(s.id) }));
    expect(collectEditableBlocks(doc).map(b => b.key)).toEqual(['exp:exp-demo', 'proj:proj-demo']);
  });
  it('enforces actual length budget at proposal parsing', () => {
    const doc = fixture();
    const blocks = collectEditableBlocks(doc);
    const block = blocks[0]!;
    expect(() => parseTailorProposalsResponse(JSON.stringify([{ blockKey: block.key, suggestedText: '甲'.repeat(block.maxCharsHint + 1) }]), blocks, buildTrustedFactCorpus(doc), [])).toThrow('字数上限');
  });
});
