import { ResumeDocumentSchema, type ResumeDocument } from '../schema/resumeSchema';
export const SAMPLE_AVATAR_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect width="120" height="160" fill="#e2e8f0"/><circle cx="60" cy="53" r="24" fill="#94a3b8"/><path d="M15 150 Q15 90 60 90 Q105 90 105 150" fill="#94a3b8"/></svg>');
export function withPreviewDemoPhoto(doc: ResumeDocument, enabled: boolean): ResumeDocument {
  if (!enabled || doc.basic.photo.trim() || !doc.basic.photoConfig.visible) return doc;
  return { ...doc, basic: { ...doc.basic, photo: SAMPLE_AVATAR_SVG } };
}
export const SAMPLE_PREVIEW_DOCUMENT = ResumeDocumentSchema.parse({
  "schemaVersion": 1,
  "id": "demo-fixture-resume",
  "title": "合成测试简历",
  "templateId": "minimal-ats",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z",
  "activeSection": "basic",
  "basic": {
    "name": "模板演示",
    "title": "示例岗位",
    "email": "preview@example.invalid",
    "phone": "",
    "location": "示例城市",
    "employmentStatus": "应届示例",
    "photo": ""
  },
  "menuSections": [
    {
      "id": "basic",
      "title": "基本信息",
      "order": 0
    },
    {
      "id": "education",
      "title": "教育经历",
      "order": 1
    },
    {
      "id": "experience",
      "title": "工作经历",
      "order": 2
    },
    {
      "id": "projects",
      "title": "项目经历",
      "order": 3
    },
    {
      "id": "skills",
      "title": "专业技能",
      "order": 4
    },
    {
      "id": "selfEvaluation",
      "title": "自我评价",
      "order": 5
    }
  ],
  "education": [
    {
      "id": "edu-demo",
      "school": "示例大学",
      "major": "科学教育",
      "degree": "硕士",
      "startDate": "2022.09",
      "endDate": "2025.06",
      "description": "- 设计实验与记录实验结果。"
    }
  ],
  "experience": [
    {
      "id": "exp-demo",
      "company": "示例机构",
      "position": "教学助理",
      "startDate": "2025.09",
      "endDate": "2026.06",
      "description": "- 协助组织30课时的教学活动。"
    }
  ],
  "projects": [
    {
      "id": "proj-demo",
      "name": "示例课程工具",
      "role": "成员",
      "date": "2025.04",
      "description": "- 制作实验演示材料并整理使用说明。"
    }
  ],
  "skillContent": "- 实验设计、数据整理与沟通",
  "selfEvaluationContent": "重视实验记录与清晰表达。",
  "globalSettings": {
    "themeColor": "#167883",
    "baseFontSize": 13,
    "sectionSpacing": 15,
    "paragraphSpacing": 8,
    "pagePadding": 28
  }
});
