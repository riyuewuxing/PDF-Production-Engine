import type { ResumeDocument } from '../schema/resumeSchema';
import {visibleBasicValue,factEntityId} from './aiContext';
function enabled(doc:ResumeDocument,id:string):boolean{return doc.menuSections.some(s=>s.id===id&&s.enabled);}


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
  /** Stable editable block identity, separate from legacy ordinal ID. */
  sourceKey?:string;
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
  employmentStatus:string;
} {
  const name=visibleBasicValue(doc,'name').trim().replace(/^\[姓名\]$/,'');
  const role=visibleBasicValue(doc,'title').trim()||'目标岗位';
  const visibleEdu=enabled(doc,'education')?doc.education.filter(e=>e.visible):[];
  const topEdu = visibleEdu[0];
  const topSchool = topEdu?.school.trim() || '';
  const topMajor = topEdu?.major.trim() || '';
  const topDegree = topEdu?.degree.trim() || '';
  const eduSummary = topEdu
    ? `${topSchool}${topMajor ? `「${topMajor}」` : ''}${topDegree ? `${topDegree}` : ''}${topEdu.gpa ? `（成绩 ${topEdu.gpa}）` : ''}`
    : '';

  const projectHighlights = doc.projects
    .filter((p) => enabled(doc,'projects') && p.visible && p.name.trim())
    .slice(0, 2)
    .map((p) => {
      const desc = trimAtSentenceBoundary(stripMarkdownTokens(p.description), 88);
      return `「${p.name.trim()}」${p.role.trim()?`（${p.role.trim()}）`:''}${desc ? `：${desc}` : ''}`;
    });

  const experienceHighlights = doc.experience
    .filter((e) => enabled(doc,'experience') && e.visible && (e.company.trim() || e.position.trim()))
    .slice(0, 2)
    .map((e) => {
      const desc = trimAtSentenceBoundary(stripMarkdownTokens(e.description), 88);
      return `${e.company.trim()} ${e.position.trim()}${desc ? `（${desc}）` : ''}`;
    });

  const skillHighlight = trimAtSentenceBoundary(
    (enabled(doc,'skills')?doc.skillContent:'')
      .split(/\r?\n/)
      .map((line) => stripMarkdownTokens(line))
      .filter(Boolean)
      .join('；'),
    140,
  );
  const contacts = [
    visibleBasicValue(doc,'phone') ? `电话：${doc.basic.phone}` : '',
    visibleBasicValue(doc,'email') ? `邮箱：${doc.basic.email}` : '',
    visibleBasicValue(doc,'location') ? `所在地：${doc.basic.location}` : '',
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
    employmentStatus:visibleBasicValue(doc,'employmentStatus'),
  };
}

export function generateCoverLetterBundle(
  doc: ResumeDocument,
  target: { company?: string; role?: string },
): CoverLetterBundle {
  const h = extractHighlights(doc);
  const targetCompany = target.company?.trim() || '贵单位';
  const targetRole = target.role?.trim() || h.role;
  const intro=[h.name?'我是'+h.name+'。':'',h.eduSummary?'我的教育背景为'+h.eduSummary+'。':'',h.employmentStatus?'目前求职状态：'+h.employmentStatus+'。':''].filter(Boolean).join('');
  const practiceLine=[...h.experienceHighlights,...h.projectHighlights].length?'相关实践与项目经历包括：'+[...h.experienceHighlights,...h.projectHighlights].join('；')+'。':'';
  const skillLine=h.skillHighlight?'简历中列有以下专业技能：'+h.skillHighlight+'。':'';
  const coverLetterText=[
    `尊敬的${targetCompany}招聘负责人：`,'',
    `您好！我希望申请${targetCompany}的「${targetRole}」岗位。${intro}`,'',
    ...[practiceLine,skillLine].filter(Boolean),'',
    '随信附上我的个人简历，期待有机会进一步沟通。感谢您的审阅！','','此致','敬礼！',
    ...(h.name?['申请人：'+h.name]:[]),...(h.contactSummary?[h.contactSummary]:[]),
  ].join('\n');
  const academic=[h.topSchool,h.topMajor,h.topDegree?'('+h.topDegree+')':''].join('');
  const emailSubject=['应聘'+targetRole,academic,h.name].filter(Boolean).join('-');
  const emailBody=[`尊敬的${targetCompany}招聘负责人您好：`,`我希望申请「${targetRole}」岗位，现附上个人简历供您参考。`,intro,practiceLine,skillLine,'期待进一步沟通，感谢您的审阅！',h.name,h.contactSummary].filter(Boolean).join('\n');
  const coreProof=h.projectHighlights[0]||h.experienceHighlights[0]||h.skillHighlight;
  const bossGreeting=[`老师/HR您好！我希望申请${targetCompany}的「${targetRole}」岗位。`,intro,coreProof?'我的相关经历或技能：'+coreProof+'。':'','方便发一份简历给您参考吗？'].filter(Boolean).join('');
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
  const isTeacherRole=/教师|老师|教研|教学|师范|teacher|teaching|educator/i.test(role);
  const isPhysicsTeacher=isTeacherRole&&/物理|physics/i.test(role);
  const isResearchRole=!isTeacherRole&&/科研|研究员|研究助理|研究岗位|实验室|researcher|research assistant|research scientist|scientist|laboratory/i.test(role);
  const topEdu=enabled(doc,'education')?doc.education.find(e=>e.visible):undefined;
  const questions: InterviewQuestionItem[] = [];

  // 1. Academic / Major grounding
  questions.push({
    id: 'q-edu-foundation',
    sourceKey:topEdu&&factEntityId(doc,'edu:'+topEdu.id)?'edu:'+topEdu.id:undefined,
    category: '专业能力',
    question: topEdu&&factEntityId(doc,'edu:'+topEdu.id)&&h.topSchool?`请结合你在${h.topSchool}${h.topMajor ? `「${h.topMajor}」` : ''}的培养经历，谈谈这段学习背景对胜任「${role}」最大的帮助是什么？`:`请介绍与你申请「${role}」相关的教育或学习背景。`,
    intent: '考察学历专业与目标岗位的底层迁移度，区分“只会考试”与“会转化运用”。',
    starHints: [
      '用 1 句话点明专业核心训练（实验设计 / 数学建模 / 严密推理）',
      '将专业方法映射到目标岗位痛点',
      '如有真实可核对成果则举例；否则说明实际训练过程，不补造指标',
    ],
  });

  // 2. Top projects probe (up to 2)
  const visibleProjects = doc.projects.filter((p) => enabled(doc,'projects') && p.visible && p.name.trim() && factEntityId(doc,'proj:'+p.id)).slice(0, 2);
  visibleProjects.forEach((proj, idx) => {
    questions.push({
      id: `q-proj-${idx + 1}`,
      sourceKey:'proj:'+proj.id,
      category: '项目深挖',
      question: `简历中提到你担任「${proj.name.trim()}」${proj.role ? `（${proj.role}）` : ''}，如果由你复盘其中遇到的最大技术或执行卡点，你是如何定位并解决的？`,
      intent: '验证项目真实参与度与个人独立贡献，过滤“只写名词不懂细节”。',
      starHints: [
        'S/T：交代该项目的明确目标与边界约束',
        'A：重点讲清你亲自做过的方案取舍与迭代动作',
        'R：如有数据、演示效果或反馈则说明来源；没有结果时坦陈进展与限制',
      ],
    });
  });

  // 3. Experience probe
  const visibleExps = doc.experience.filter((e) => enabled(doc,'experience') && e.visible && e.company.trim() && factEntityId(doc,'exp:'+e.id)).slice(0, 2);
  visibleExps.forEach((exp, idx) => {
    questions.push({
      id: `q-exp-${idx + 1}`,
      sourceKey:'exp:'+exp.id,
      category: '项目深挖',
      question: `在「${exp.company.trim()}」${exp.position?`担任「${exp.position}」`:'的经历'}中，哪一次具体任务或反馈让你成长最快？如果重做一次会怎么优化？`,
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
        question: isPhysicsTeacher?'物理学科中如电磁感应或复合场运动，你会如何在试讲或分层辅导中帮助基础薄弱学生建立物理图像？':'请选择目标学科中一个学生常见的理解难点，说明如何设计教学、识别错因及检查学习效果。',
        intent: '练习学科教法与学情转化，不代表真实面试必问。',
        starHints: [
          isPhysicsTeacher?'给出“现象直观感知 → 物理模型抽象 → 典型错因辨析”三步法':'明确学习目标、教学活动和学习效果检验方式',
          '如实际做过仿真课件或可视化实验，可结合实例；否则说明拟采用的方法',
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
        question: '如何将数字化工具或可视化实验融入常规课堂，同时不沦为“炫技”？如有实际相关经历，可结合实例。',
        intent: '考察教研创新意识与课堂效率的平衡能力。',
        starHints: ['明确工具只服务于“传统器材难以演示的微观/瞬时过程”', '保留学生动手推导与板书主线'],
      },
    );
  } else if(isResearchRole){
    questions.push({id:'q-research-method',category:'专业能力',question:'请选取一项真实科研或实验经历，说明你负责的任务、关键假设、数据处理和如何判断结果可靠。',intent:'考察研究方法、可复现性与个人贡献边界。',starHints:['区分本人完成、协作完成及尚未完成的工作','说明误差来源、验证方法和实际可核对的产物；不虚构论文、独立主持或定量结果']},{id:'q-research-transfer',category:'综合素质',question:'如果研究假设未得到支持或结果难以复现，你会如何安排后续验证并向团队沟通？',intent:'考察科研诚信、证据意识及协作。',starHints:['区分实际经历与拟采用的方法','保留失败结果和限制，说明下一步验证而不是编造成功']});
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
  questions.push({
    id: 'q-timeline-motivation',
    category: '时间线与动机',
    question: `请说明近期学习、工作或求职准备的时间线，以及选择「${role}」的原因。有哪些能够核实的具体积累？`,
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
    question: '请举一个你实际经历过的、主动提高工作或学习质量的例子。如果没有量化数据，如何说明改进效果？',
    intent: '区分泛泛套话与真实高标准自驱力。',
    starHints: ['选取具体作品或教学材料从零到一打磨经历', '有实际数据再量化；没有数据则说明可核对的过程、产物与局限'],
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

  if(questions.length<8)questions.push({id:'q-example-evidence',category:'综合素质',question:'请选一个你愿意提供证据的真实经历，说明个人职责、困难、行动与结果。',intent:'核对事实与表达一致性。',starHints:['区分个人贡献与团队贡献','无法量化时说明可核对的过程和产物']});
  if(questions.length<8)questions.push({id:'q-learning',category:'专业能力',question:'面对陌生岗位任务，你如何识别知识缺口并完成一次可验证的学习？',intent:'考察学习与验证方法。',starHints:['明确缺口','说明如何检验学习成果']});
  return questions.slice(0,12);
}

