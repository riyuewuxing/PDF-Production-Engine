import type { ResumeDocument } from '../schema/resumeSchema';

export interface PrivacyRedactionOptions {
  hideName?: boolean;
  maskPhone?: boolean;
  maskEmail?: boolean;
  hidePhoto?: boolean;
  customTerms?: string[];
}

export function parseCustomRedactionTerms(rawInput: string): string[] {
  return Array.from(
    new Set(
      rawInput
        .split(/[\n,，;；]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  ).sort((a, b) => b.length - a.length);
}

export function maskPersonName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed || trimmed === '[姓名]') return trimmed;
  if (/^[\u4e00-\u9fa5]/.test(trimmed)) {
    return `${trimmed.slice(0, 1)}某`;
  }
  return `${trimmed.slice(0, 1)}***`;
}

export function maskPhoneNumber(raw: string): string {
  // Mainland mobile formats: contiguous digits or hyphen/space separated (avoid email local-parts)
  let next = raw.replace(
    /(?<![\dA-Za-z._%+-])(1[3-9]\d)([\s-]?)(\d{4})([\s-]?)(\d{4})(?![\d@])/g,
    '$1$2****$4$5',
  );
  // Fallback pure phone field containing 7-15 digits
  if (next === raw && /^\s*[\d+\s()-]{7,20}\s*$/.test(raw)) {
    next = raw.replace(/\d{7,}/g, (digits) => {
      if (digits.length <= 4) return '****';
      return `${digits.slice(0, 3)}${'*'.repeat(Math.max(4, digits.length - 6))}${digits.slice(-3)}`;
    });
  }
  return next;
}

export function maskEmailAddress(raw: string): string {
  return raw.replace(
    /([A-Za-z0-9._%+-]{1,3})[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    '$1****$2',
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scrubFreeText(
  text: string,
  opts: {
    maskPhone: boolean;
    maskEmail: boolean;
    realName?: string;
    maskedName?: string;
    customTerms: string[];
  },
): string {
  if (!text) return text;
  let result = text;
  // Mask emails BEFORE phone numbers so numeric email local-parts are handled correctly
  if (opts.maskEmail) {
    result = maskEmailAddress(result);
  }
  if (opts.maskPhone) {
    result = maskPhoneNumber(result);
  }
  if (opts.realName && opts.realName.length >= 2 && opts.maskedName) {
    result = result.replace(new RegExp(escapeRegExp(opts.realName), 'g'), opts.maskedName);
  }
  for (const term of opts.customTerms) {
    if (!term) continue;
    result = result.replace(new RegExp(escapeRegExp(term), 'gi'), '[某单位]');
  }
  return result;
}

/**
 * Returns a redacted deep clone of a ResumeDocument without mutating the source object.
 */
export function redactResumeDocument(
  doc: ResumeDocument,
  options: PrivacyRedactionOptions = {},
): ResumeDocument {
  const hideName = options.hideName ?? true;
  const maskPhone = options.maskPhone ?? true;
  const maskEmail = options.maskEmail ?? true;
  const hidePhoto = options.hidePhoto ?? true;
  const customTerms = [...(options.customTerms ?? [])]
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length);

  const realName = doc.basic.name.trim();
  const maskedName = hideName ? maskPersonName(realName) : realName;
  const scrubOpts = {
    maskPhone,
    maskEmail,
    realName: hideName && realName && realName !== '[姓名]' ? realName : undefined,
    maskedName,
    customTerms,
  };

  return {
    ...doc,
    title: scrubFreeText(doc.title, scrubOpts),
    basic: {
      ...doc.basic,
      name: maskedName,
      title: scrubFreeText(doc.basic.title, scrubOpts),
      phone: maskPhone ? maskPhoneNumber(doc.basic.phone) : doc.basic.phone,
      email: maskEmail ? maskEmailAddress(doc.basic.email) : doc.basic.email,
      location: scrubFreeText(doc.basic.location, scrubOpts),
      employmentStatus: scrubFreeText(doc.basic.employmentStatus, scrubOpts),
      photo: hidePhoto ? '' : doc.basic.photo,
      photoConfig: {
        ...doc.basic.photoConfig,
        visible: hidePhoto ? false : doc.basic.photoConfig.visible,
      },
      customFields: doc.basic.customFields.map((cf) => ({
        ...cf,
        value: scrubFreeText(cf.value, scrubOpts),
      })),
    },
    education: doc.education.map((edu) => ({
      ...edu,
      school: scrubFreeText(edu.school, scrubOpts),
      major: scrubFreeText(edu.major, scrubOpts),
      description: scrubFreeText(edu.description, scrubOpts),
    })),
    experience: doc.experience.map((exp) => ({
      ...exp,
      company: scrubFreeText(exp.company, scrubOpts),
      position: scrubFreeText(exp.position, scrubOpts),
      location: scrubFreeText(exp.location, scrubOpts),
      description: scrubFreeText(exp.description, scrubOpts),
    })),
    projects: doc.projects.map((proj) => ({
      ...proj,
      name: scrubFreeText(proj.name, scrubOpts),
      role: scrubFreeText(proj.role, scrubOpts),
      link: maskEmail || maskPhone ? '' : proj.link,
      description: scrubFreeText(proj.description, scrubOpts),
    })),
    skillContent: scrubFreeText(doc.skillContent, scrubOpts),
    selfEvaluationContent: scrubFreeText(doc.selfEvaluationContent, scrubOpts),
    customData: Object.fromEntries(
      Object.entries(doc.customData).map(([sectionId, items]) => [
        sectionId,
        items.map((item) => ({
          ...item,
          title: scrubFreeText(item.title, scrubOpts),
          subtitle: scrubFreeText(item.subtitle, scrubOpts),
          description: scrubFreeText(item.description, scrubOpts),
        })),
      ]),
    ),
  };
}
