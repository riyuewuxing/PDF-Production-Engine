import {
  CustomItem,
  EducationItem,
  ExperienceItem,
  ProjectItem,
  ResumeDocument,
  normalizeSectionsOrder,
} from '../schema/resumeSchema';

export interface MasterMergeSelection {
  educationIds: string[];
  experienceIds: string[];
  projectIds: string[];
  customItems: Record<string, string[]>; // masterSectionId -> selected item ids
  includeSkillContent?: 'append' | 'replace' | null;
  includeSelfEvaluation?: 'append' | 'replace' | null;
}

export function mergeMasterItemsIntoResume(
  target: ResumeDocument,
  master: ResumeDocument,
  selection: MasterMergeSelection,
): ResumeDocument {
  let next: ResumeDocument = {
    ...target,
    education: [...target.education],
    experience: [...target.experience],
    projects: [...target.projects],
    menuSections: [...target.menuSections],
    customData: { ...target.customData },
  };

  const ensureSectionEnabled = (id: string, title: string, icon = 'FileText') => {
    const existing = next.menuSections.find((s) => s.id === id);
    if (existing) {
      if (!existing.enabled) {
        next.menuSections = next.menuSections.map((s) =>
          s.id === id ? { ...s, enabled: true } : s,
        );
      }
      return;
    }
    next.menuSections = normalizeSectionsOrder([
      ...next.menuSections,
      {
        id,
        title,
        icon,
        enabled: true,
        order: next.menuSections.length,
        pageBreakBefore: false,
      },
    ]);
  };

  if (selection.educationIds.length > 0) {
    const picked: EducationItem[] = master.education
      .filter((item) => selection.educationIds.includes(item.id))
      .map((item) => ({ ...item, id: crypto.randomUUID(), visible: true }));
    if (picked.length > 0) {
      next.education = [...next.education, ...picked];
      ensureSectionEnabled('education', '教育经历', 'GraduationCap');
    }
  }

  if (selection.experienceIds.length > 0) {
    const picked: ExperienceItem[] = master.experience
      .filter((item) => selection.experienceIds.includes(item.id))
      .map((item) => ({ ...item, id: crypto.randomUUID(), visible: true }));
    if (picked.length > 0) {
      next.experience = [...next.experience, ...picked];
      ensureSectionEnabled('experience', '工作经历', 'Briefcase');
    }
  }

  if (selection.projectIds.length > 0) {
    const picked: ProjectItem[] = master.projects
      .filter((item) => selection.projectIds.includes(item.id))
      .map((item) => ({ ...item, id: crypto.randomUUID(), visible: true }));
    if (picked.length > 0) {
      next.projects = [...next.projects, ...picked];
      ensureSectionEnabled('projects', '项目经历', 'Rocket');
    }
  }

  for (const [masterSecId, selectedIds] of Object.entries(selection.customItems)) {
    if (selectedIds.length === 0) continue;
    const masterList = master.customData[masterSecId] ?? [];
    const picked: CustomItem[] = masterList
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => ({ ...item, id: crypto.randomUUID(), visible: true }));
    if (picked.length === 0) continue;

    const masterSectionMeta = master.menuSections.find((s) => s.id === masterSecId);
    const masterTitle = masterSectionMeta?.title ?? '自定义模块';

    // Match existing custom section by id or title
    const targetSection =
      next.menuSections.find((s) => s.id === masterSecId) ??
      next.menuSections.find((s) => s.id.startsWith('custom-') && s.title === masterTitle);
    const destId = targetSection?.id ?? masterSecId;

    ensureSectionEnabled(destId, masterTitle, masterSectionMeta?.icon ?? 'FileText');
    next.customData[destId] = [...(next.customData[destId] ?? []), ...picked];
  }

  if (selection.includeSkillContent && master.skillContent.trim()) {
    if (selection.includeSkillContent === 'replace' || !next.skillContent.trim()) {
      next.skillContent = master.skillContent;
    } else {
      next.skillContent = `${next.skillContent.trim()}\n${master.skillContent.trim()}`;
    }
    ensureSectionEnabled('skills', '专业技能', 'Zap');
  }

  if (selection.includeSelfEvaluation && master.selfEvaluationContent.trim()) {
    if (selection.includeSelfEvaluation === 'replace' || !next.selfEvaluationContent.trim()) {
      next.selfEvaluationContent = master.selfEvaluationContent;
    } else {
      next.selfEvaluationContent = `${next.selfEvaluationContent.trim()}\n${master.selfEvaluationContent.trim()}`;
    }
    ensureSectionEnabled('selfEvaluation', '自我评价', 'User');
  }

  return next;
}
