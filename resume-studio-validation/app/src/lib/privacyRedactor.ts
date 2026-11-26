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
  // Mainland mobile patterns like 13800138000 or 138-0013-8000 or 138 0013 8000 (avoid email local-parts)
  let next = raw.replace(
    /(?<![\dA-Za-z._%+-])(1[3-9]\d)([\s-]?)(\d{4})([\s-]?)(\d{4})(?![\d@])/g,
    '$1$2****$4$5',
  );
  // Only a dedicated phone field or an explicitly known phone uses this fallback.
  const digits = raw.replace(/\D/g, '');
  if (next === raw && /^\s*[\d+\s()-]+\s*$/.test(raw) && digits.length >= 7 && digits.length <= 15) {
    if (/^\s*\d{7,15}\s*$/.test(raw)) {
      next = raw.replace(/\d{7,15}/g, d => d.slice(0,3)+'*'.repeat(Math.max(4,d.length-6))+d.slice(-3));
    } else {
      let index=0;
      next=raw.replace(/\d/g,d=>{const i=index++;return i>=3&&i<digits.length-3?'*':d;});
    }
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

type ScrubOptions = {
  maskPhone:boolean; maskEmail:boolean; realName?:string; maskedName?:string;
  knownPhone?:string; customTerms:string[];
};

function scrubFreeText(text:string, opts:ScrubOptions, fieldMask?:string):string {
  if (!text) return text;
  const spans:Array<{start:number;end:number;replacement:string;explicit:boolean}>=[];
  const collect=(pattern:RegExp,replace:(s:string)=>string,explicit=false)=>{
    for(const match of text.matchAll(pattern)){
      const value=match[0],replacement=replace(value);
      if(value&&value!==replacement)spans.push({start:match.index!,end:match.index!+value.length,replacement,explicit});
    }
  };
  // Match on the ORIGINAL text, so a partial automatic mask cannot prevent
  // an explicitly requested term from being recognized.
  for(const term of opts.customTerms)collect(new RegExp(escapeRegExp(term),'gi'),()=> '[某单位]',true);
  if(opts.maskEmail)collect(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,maskEmailAddress);
  if(opts.maskPhone){
    collect(/(?<![\dA-Za-z._%+-])1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?![\d@])/g,maskPhoneNumber);
    if(opts.knownPhone&&maskPhoneNumber(opts.knownPhone)!==opts.knownPhone)
      collect(new RegExp('(?<!\\d)'+escapeRegExp(opts.knownPhone)+'(?!\\d)','g'),maskPhoneNumber);
  }
  if(opts.realName&&opts.realName.length>=2&&opts.maskedName)
    collect(new RegExp(escapeRegExp(opts.realName),'gi'),()=>opts.maskedName!);
  if(fieldMask!==undefined&&fieldMask!==text)spans.push({start:0,end:text.length,replacement:fieldMask,explicit:false});
  spans.sort((a,b)=>a.start-b.start||b.end-a.end);
  const merged:typeof spans=[];
  for(const span of spans){
    const last=merged[merged.length-1];
    if(!last||span.start>=last.end){merged.push({...span});continue;}
    if(last.start===span.start&&last.end===span.end&&last.replacement===span.replacement){last.explicit ||= span.explicit;continue;}
    last.end=Math.max(last.end,span.end);
    last.explicit ||= span.explicit;
    last.replacement=last.explicit?'[某单位]':'[已脱敏]';
  }
  let result='',offset=0;
  for(const span of merged){result+=text.slice(offset,span.start)+span.replacement;offset=span.end;}
  return result+text.slice(offset);
}

function scrubProjectLink(link:string,opts:ScrubOptions):string{
  if(opts.maskEmail||opts.maskPhone)return '';
  if(scrubFreeText(link,opts)!==link)return '';
  try{const decoded=decodeURIComponent(link);if(scrubFreeText(decoded,opts)!==decoded)return '';}catch{/* preserve unrelated malformed legacy text */}
  return link;
}

/**
 * Returns a redacted deep clone of a ResumeDocument without mutating the source object.
 */
export function redactResumeDocument(
  doc: ResumeDocument,
  options: PrivacyRedactionOptions = {},
): ResumeDocument {
  doc = structuredClone(doc);
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
    knownPhone: doc.basic.phone.trim(),
    customTerms,
  };

  return {
    ...doc,
    title: scrubFreeText(doc.title, scrubOpts),
    basic: {
      ...doc.basic,
      name: scrubFreeText(doc.basic.name, scrubOpts, hideName ? maskedName : undefined),
      title: scrubFreeText(doc.basic.title, scrubOpts),
      phone: scrubFreeText(doc.basic.phone, scrubOpts, maskPhone ? maskPhoneNumber(doc.basic.phone) : undefined),
      email: scrubFreeText(doc.basic.email, scrubOpts, maskEmail ? maskEmailAddress(doc.basic.email) : undefined),
      birthDate: scrubFreeText(doc.basic.birthDate, scrubOpts),
      fieldOrder: doc.basic.fieldOrder.map(f=>({...f,label:scrubFreeText(f.label,scrubOpts)})),
      location: scrubFreeText(doc.basic.location, scrubOpts),
      employmentStatus: scrubFreeText(doc.basic.employmentStatus, scrubOpts),
      photo: hidePhoto ? '' : doc.basic.photo,
      photoConfig: {
        ...doc.basic.photoConfig,
        visible: hidePhoto ? false : doc.basic.photoConfig.visible,
      },
      customFields: doc.basic.customFields.map((cf) => ({
        ...cf,
        label: scrubFreeText(cf.label, scrubOpts),
        value: scrubFreeText(cf.value, scrubOpts),
      })),
    },
    menuSections: doc.menuSections.map(s=>({...s,title:scrubFreeText(s.title,scrubOpts)})),
    education: doc.education.map((edu) => ({
      ...edu,
      school: scrubFreeText(edu.school, scrubOpts),
      major: scrubFreeText(edu.major, scrubOpts),
      degree: scrubFreeText(edu.degree,scrubOpts),
      gpa: scrubFreeText(edu.gpa,scrubOpts),
      startDate: scrubFreeText(edu.startDate,scrubOpts),
      endDate: scrubFreeText(edu.endDate,scrubOpts),
      description: scrubFreeText(edu.description, scrubOpts),
    })),
    experience: doc.experience.map((exp) => ({
      ...exp,
      company: scrubFreeText(exp.company, scrubOpts),
      position: scrubFreeText(exp.position, scrubOpts),
      location: scrubFreeText(exp.location, scrubOpts),
      startDate: scrubFreeText(exp.startDate,scrubOpts),
      endDate: scrubFreeText(exp.endDate,scrubOpts),
      description: scrubFreeText(exp.description, scrubOpts),
    })),
    projects: doc.projects.map((proj) => ({
      ...proj,
      name: scrubFreeText(proj.name, scrubOpts),
      role: scrubFreeText(proj.role, scrubOpts),
      date: scrubFreeText(proj.date,scrubOpts),
      linkLabel: scrubFreeText(proj.linkLabel,scrubOpts),
      link: scrubProjectLink(proj.link,scrubOpts),
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
          dateRange: scrubFreeText(item.dateRange,scrubOpts),
          description: scrubFreeText(item.description, scrubOpts),
        })),
      ]),
    ),
  };
}
