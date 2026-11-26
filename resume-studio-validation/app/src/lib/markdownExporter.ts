import {
  getBasicMetaItems,
  getOrderedVisibleSections,
} from '../templates/shared';
import { getLocaleLabels } from './resumeLocale';
import { visibleBasicValue } from './aiContext';
import type { ResumeDocument } from '../schema/resumeSchema';

export function resumeToMarkdown(doc: ResumeDocument): string {
  const labels = getLocaleLabels(doc.globalSettings.locale);
  const lines: string[] = [];
  const basicEnabled = doc.menuSections.some(s => s.id === 'basic' && s.enabled);
  const name = visibleBasicValue(doc, 'name').trim() || labels.unnamed;
  const role = visibleBasicValue(doc, 'title').trim();
  lines.push(`# ${name}`);

  const metaParts: string[] = [];
  if (role) {
    metaParts.push(`${labels.targetRole}${role}`);
  }
  for (const item of basicEnabled ? getBasicMetaItems(doc) : []) {
    metaParts.push(`${item.label}${labels.colon}${item.value}`);
  }
  if (metaParts.length > 0) {
    lines.push('', `> ${metaParts.join(' | ')}`);
  }

  for (const section of getOrderedVisibleSections(doc)) {
    lines.push('', `## ${section.title}`);

    if (section.id === 'education') {
      for (const edu of doc.education.filter((e) => e.visible)) {
        const heading = [
          edu.school,
          edu.major,
          edu.degree ? `${labels.openParen}${edu.degree}${labels.closeParen}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        const dates = [edu.startDate, edu.endDate].filter(Boolean).join(' - ');
        lines.push('', `### ${heading}${dates ? ` (${dates})` : ''}`);
        if (edu.gpa.trim()) lines.push(`- ${labels.gpa}${edu.gpa.trim()}`);
        if (edu.description.trim()) lines.push(edu.description.trim());
      }
      continue;
    }

    if (section.id === 'experience') {
      for (const exp of doc.experience.filter((e) => e.visible)) {
        const heading = [exp.company, exp.position].filter(Boolean).join(' · ');
        const dates = [exp.startDate, exp.endDate].filter(Boolean).join(' - ');
        lines.push('', `### ${heading}${dates ? ` (${dates})` : ''}`);
        if (exp.location.trim()) lines.push(`- ${labels.location}${exp.location.trim()}`);
        if (exp.description.trim()) lines.push(exp.description.trim());
      }
      continue;
    }

    if (section.id === 'projects') {
      for (const proj of doc.projects.filter((p) => p.visible)) {
        const heading = [proj.name, proj.role].filter(Boolean).join(' · ');
        lines.push('', `### ${heading}${proj.date.trim() ? ` (${proj.date.trim()})` : ''}`);
        if (proj.link.trim()) {
          lines.push(
            `- ${labels.link}${labels.colon}${proj.linkLabel.trim() || proj.link.trim()} (${proj.link.trim()})`,
          );
        }
        if (proj.description.trim()) lines.push(proj.description.trim());
      }
      continue;
    }

    if (section.id === 'skills') {
      if (doc.skillContent.trim()) {
        lines.push('', doc.skillContent.trim());
      }
      continue;
    }

    if (section.id === 'selfEvaluation') {
      if (doc.selfEvaluationContent.trim()) {
        lines.push('', doc.selfEvaluationContent.trim());
      }
      continue;
    }

    const customItems = (doc.customData[section.id] ?? []).filter((c) => c.visible);
    for (const item of customItems) {
      const sub = item.subtitle.trim() ? ` · ${item.subtitle.trim()}` : '';
      const date = item.dateRange.trim() ? ` (${item.dateRange.trim()})` : '';
      lines.push('', `- **${item.title.trim() || labels.unnamed}**${sub}${date}`);
      if (item.description.trim()) lines.push(`  ${item.description.trim()}`);
    }
  }

  return `${lines.join('\n').trim()}\n`;
}
