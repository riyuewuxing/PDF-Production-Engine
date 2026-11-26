import type { ResumeDocument } from '../schema/resumeSchema';


export interface CoverLetterBundle {
  coverLetterText: string;
  emailSubject: string;
  emailBody: string;
  bossGreeting: string;
}

export interface InterviewQuestionItem {
  id: string;
  category: '项目深挖' | '专业能力' | '时间线与动机' | '综合素质';
  question: string;
  intent: string;
  starHints: string[];
}

function stripMarkdownTokens(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimAtSentenceBoundary(text: string, maxLen: number): string {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  const slice = clean.slice(0, maxLen);
  const lastStop = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('；'),
    slice.lastIndexOf('，'),
    slice.lastIndexOf('、'),
    slice.lastIndexOf('·'),
  );
  if (lastStop >= Math.floor(maxLen * 0.45)) {
    return slice.slice(0, lastStop).trim();
  }
  return slice.trim();
}

function extractHighlights(doc: ResumeDocument): {
  name: string;
  role: string;
  eduSummary: string;
  topSchool: string;
  topMajor: string;
  topDegree: string;
  projectHighlights: string[];
  experienceHighlights: string[];
  skillHighlight: string;
  contactSummary: string;
} {
  const name =
    doc.basic.name.trim() && doc.basic.name.trim() !== '[姓名]' ? doc.basic.name.trim() : '候选人';
  const role = doc.basic.title.trim() || '目标岗位';
  const visibleEdu = doc.education.filter((e) => e.visible);
  const topEdu = visibleEdu[0];
  const topSchool = topEdu?.school.trim() || '相关院校';
  const topMajor = topEdu?.major.trim() || '相关专业';
  const topDegree = topEdu?.degree.trim() || '';
  const eduSummary = topEdu
    ? `${topSchool}${topMajor ? `「${topMajor}」` : ''}${topDegree ? `${topDegree}` : ''}${topEdu.gpa ? `（成绩 ${topEdu.gpa}）` : ''}`
    : '具备扎实的专业学术训练与独立研究能力';

  const projectHighlights = doc.projects
    .filter((p) => p.visible && p.name.trim())
    .slice(0, 2)
    .map((p) => {
      const desc = trimAtSentenceBoundary(stripMarkdownTokens(p.description), 88);
      return `「${p.name.trim()}」${desc ? `（${desc}）` : ''}`;
    });

  const experienceHighlights = doc.experience
    .filter((e) => e.visible && (e.company.trim() || e.position.trim()))
    .slice(0, 2)
    .map((e) => {
      const desc = trimAtSentenceBoundary(stripMarkdownTokens(e.description), 88);
      return `${e.company.trim()} ${e.position.trim()}${desc ? `（${desc}）` : ''}`;
    });

  const skillHighlight = trimAtSentenceBoundary(
    doc.skillContent
      .split(/\r?\n/)
      .map((line) => stripMarkdownTokens(line))
      .filter(Boolean)
      .join('；'),
    140,
  );
  const contacts = [
    doc.basic.phone ? `电话：${doc.basic.phone}` : '',
    doc.basic.email ? `邮箱：${doc.basic.email}` : '',
    doc.basic.location ? `所在地：${doc.basic.location}` : '',
  ].filter(Boolean);

  return {
    name,
    role,
    eduSummary,
    topSchool,
    topMajor,
    topDegree,
    projectHighlights,
    experienceHighlights,
    skillHighlight,
    contactSummary: contacts.join(' | '),
  };
}

export function generateCoverLetterBundle(
  doc: ResumeDocument,
  target: { company?: string; role?: string },
): CoverLetterBundle {
  const h = extractHighlights(doc);
  const targetCompany = target.company?.trim() || '贵单位';
  const targetRole = target.role?.trim() || h.role;
  const practiceLine =
    h.experienceHighlights.length > 0
      ? `在实践经历方面，我曾参与 ${h.experienceHighlights.join('；')}，锻炼了扎实的一线执行与协作能力。`
      : h.projectHighlights.length > 0
        ? `在项目与教研实践中，我主导/参与了 ${h.projectHighlights.join('；')}，沉淀了可复用的方法与量化成果。`
        : '在过往学习与科研训练中，我保持了严谨的问题拆解与快速交付习惯。';

  const skillLine = h.skillHighlight
    ? `此外，我已具备 ${h.skillHighlight} 等资质与专项技能，能够在到岗后快速胜任核心职责。`
    : '具备良好的专业迁移能力与抗压沟通素质，期待能够快速融入团队贡献价值。';

  const coverLetterText = [
    `尊敬的${targetCompany}招聘负责老师/HR：`,
    '',
    `您好！获悉${targetCompany}正在招聘「${targetRole}」，我非常期待能够申请该岗位。我是${h.name}，毕业于${h.eduSummary}，目前求职状态为「${doc.basic.employmentStatus || '可尽快到岗'}」。`,
    '',
    practiceLine,
    skillLine,
    '',
    `随信附上我的个人简历，诚盼能获得与您进一步沟通或面试试讲的机会。感谢您的宝贵时间！`,
    '',
    `此致`,
    `敬礼！`,
    `申请人：${h.name}`,
    ...(h.contactSummary ? [h.contactSummary] : []),
  ].join('\n');

  const emailSubject = `应聘${targetRole}-${h.topSchool}${h.topMajor}${h.topDegree ? `(${h.topDegree})` : ''}-${h.name}`;
  const emailBody = [
    `尊敬的${targetCompany}招聘老师您好：`,
    '',
    `我在招聘信息中了解到贵单位正在招聘「${targetRole}」岗位，现特附上个人简历予以自荐。`,
    `我毕业于${h.eduSummary}，${h.projectHighlights[0] ? `重点开展过${h.projectHighlights[0]}` : '具备扎实专业功底'}${h.skillHighlight ? `，持有/掌握：${h.skillHighlight}` : ''}。`,
    '',
    `附件为我的 PDF 个人简历，期待有机会参加后续面试或试讲考察！`,
    '',
    `${h.name}`,
    h.contactSummary,
  ]
    .filter(Boolean)
    .join('\n');

  const coreProof =
    h.projectHighlights[0] ||
    h.experienceHighlights[0] ||
    (h.skillHighlight ? `掌握 ${h.skillHighlight.slice(0, 42)}` : h.eduSummary);

  const bossGreeting = `老师/HR您好！我是毕业于${h.topSchool}${h.topMajor}${h.topDegree}的${h.name}，关注到${targetCompany}的「${targetRole}」岗位。过往有${coreProof}等实践积累，目前${doc.basic.employmentStatus || '可随时到岗'}，方便发一份简历给您参考吗？`;

  return {
    coverLetterText,
    emailSubject,
    emailBody,
    bossGreeting,
  };
}

export function generateInterviewQuestions(
  doc: ResumeDocument,
  targetRoleInput?: string,
): InterviewQuestionItem[] {
  const h = extractHighlights(doc);
  const role = targetRoleInput?.trim() || h.role;
  const fullText = JSON.stringify({
    title: role,
    edu: doc.education,
    exp: doc.experience,
    proj: doc.projects,
    skill: doc.skillContent,
    eval: doc.selfEvaluationContent,
    custom: doc.customData,
  });

  const isTeacherRole = /教师|老师|物理|教研|中学|师范|教学/.test(fullText);
  const questions: InterviewQuestionItem[] = [];

  // 1. Academic / Major grounding
  questions.push({
    id: 'q-edu-foundation',
    category: '专业能力',
    question: `请结合你在${h.topSchool}${h.topMajor ? `「${h.topMajor}」` : ''}的培养经历，谈谈这段学习背景对胜任「${role}」最大的帮助是什么？`,
    intent: '考察学历专业与目标岗位的底层迁移度，区分“只会考试”与“会转化运用”。',
    starHints: [
      '用 1 句话点明专业核心训练（实验设计 / 数学建模 / 严密推理）',
      '将专业方法映射到目标岗位痛点',
      '落到 1 个具体成果指标或课程/竞赛表现上',
    ],
  });

  // 2. Top projects probe (up to 2)
  const visibleProjects = doc.projects.filter((p) => p.visible && p.name.trim()).slice(0, 2);
  visibleProjects.forEach((proj, idx) => {
    questions.push({
      id: `q-proj-${idx + 1}`,
      category: '项目深挖',
      question: `简历中提到你担任「${proj.name.trim()}」${proj.role ? `（${proj.role}）` : ''}，如果由你复盘其中遇到的最大技术或执行卡点，你是如何定位并解决的？`,
      intent: '验证项目真实参与度与个人独立贡献，过滤“只写名词不懂细节”。',
      starHints: [
        'S/T：交代该项目的明确目标与边界约束',
        'A：重点讲清你亲自做过的方案取舍与迭代动作',
        'R：用数据/演示效果/他人反馈证明有效性',
      ],
    });
  });

  // 3. Experience probe
  const visibleExps = doc.experience.filter((e) => e.visible && e.company.trim()).slice(0, 2);
  visibleExps.forEach((exp, idx) => {
    questions.push({
      id: `q-exp-${idx + 1}`,
      category: '项目深挖',
      question: `在「${exp.company.trim()}」担任「${exp.position || role}」期间，哪一次具体任务或反馈让你成长最快？如果重做一次会怎么优化？`,
      intent: '考察一线工作成熟度、复盘习惯以及高压环境下的抗挫力。',
      starHints: ['先给具体事件场景，避免空泛总结', '诚恳说明当时的不足与改进措施'],
    });
  });

  // 4. Teaching vs Tech/General domain depth
  if (isTeacherRole) {
    questions.push(
      {
        id: 'q-teach-difficult',
        category: '专业能力',
        question: '高中物理中诸如电磁感应/带电粒子在复合场中运动是高频失分点，你在无生试讲或分层辅导时如何帮助基础薄弱学生建立物理图像？',
        intent: '高频学科教法与学情转化能力考察，重点中学必问。',
        starHints: [
          '给出“现象直观感知 → 物理模型抽象 → 典型错因辨析”三步法',
          '结合你做过的仿真课件或可视化实验说明如何降维',
        ],
      },
      {
        id: 'q-teach-class',
        category: '综合素质',
        question: '如果入职后同时承担班主任工作并面临月考成绩波动或家校沟通分歧，你会如何稳定班级节奏并与家长有效沟通？',
        intent: '考察育人同理心、家校沟通边界感与情绪稳定性。',
        starHints: ['先共情安抚再摆事实数据', '给出分层辅导清单与短期家校协同节点'],
      },
      {
        id: 'q-teach-lab',
        category: '专业能力',
        question: '结合你的科研实验与课件开发背景，如何将数字化工具/AI 可视化融入常规 45 分钟课堂，同时不沦为“炫技”？',
        intent: '考察教研创新意识与课堂效率的平衡能力。',
        starHints: ['明确工具只服务于“传统器材难以演示的微观/瞬时过程”', '保留学生动手推导与板书主线'],
      },
    );
  } else {
    questions.push(
      {
        id: 'q-domain-core',
        category: '专业能力',
        question: `围绕「${role}」最核心的岗位能力，请选取你技能栏中最有把握的一项，讲一个真实落地的复杂问题排查过程。`,
        intent: '深度检验专业技能熟练度而非仅停留在“熟悉/了解”。',
        starHints: ['描述输入现象与错误边界', '给出验证假设与最终方案对比'],
      },
      {
        id: 'q-collab-conflict',
        category: '综合素质',
        question: '在跨部门/团队协作推进任务时，如果与合作方在优先级或方案上产生分歧，你通常会如何推动达成共识？',
        intent: '考察推动力与职场沟通情商。',
        starHints: ['回到共同业务目标', '用客观数据或低成本原型验证而非纯嘴上争论'],
      },
    );
  }

  // 5. Timeline gap / career pivot check
  const hasGapHint = /2024|2025/.test(fullText) && visibleExps.length === 0;
  questions.push({
    id: 'q-timeline-motivation',
    category: '时间线与动机',
    question: hasGapHint
      ? `从你的经历时间线来看，近期主要以学术/备考准备为主（暂未全职在企业/学校长期任职），这段时间你有哪些主动输出或自我迭代？为什么坚定选择「${role}」？`
      : `是什么契机促使你当前考虑「${role}」方向，相比同龄候选人你的核心差异化优势在哪里？`,
    intent: '提前排雷空窗期、稳定性与岗位真实意愿度。',
    starHints: [
      '坦诚客观交代时间去向，强调持续自驱产出（作品/证书/备课积累）',
      '表达对目标城市与行业发展的长期稳定性规划',
    ],
  });

  // 6. Quantitative & Honor validation
  questions.push({
    id: 'q-metric-verify',
    category: '综合素质',
    question: `简历中写了${doc.selfEvaluationContent.trim() ? '自我评价中的个人优势' : '多项专业成果与奖项'}，请举一个“在没有外部明确标准下，你依然把标准做高”的例子。`,
    intent: '区分泛泛套话与真实高标准自驱力。',
    starHints: ['选取具体作品或教学材料从零到一打磨经历', '量化对比优化前后差异'],
  });

  // 7. 90-day onboarding & closing question
  questions.push({
    id: 'q-onboarding-plan',
    category: '时间线与动机',
    question: `如果顺利入职「${role}」，前 3 个月你打算如何快速完成角色适应并做出第一个可感知的贡献？`,
    intent: '考察岗位认知成熟度与落地节奏感。',
    starHints: ['第 1 个月：摸清规范/学情与现有流程', '第 2–3 个月：交付首批标准成果或改进 1 个痛点'],
  });

  // Ensure 8-12 questions
  if (questions.length < 8) {
    questions.push({
      id: 'q-extra-pressure',
      category: '综合素质',
      question: '当同时面临多线截止日期冲突时，你如何进行任务拆解与优先级排序？',
      intent: '考察高压多任务管理与可靠性。',
      starHints: ['紧急重要四象限区分', '提前暴露风险并同步关键节点'],
    });
  }

  return questions.slice(0, 12);
}

