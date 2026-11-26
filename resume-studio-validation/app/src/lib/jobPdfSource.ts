import {JobPdfOriginSchema,MAX_JOB_PDF_TEXT,validJobPdfOrigin,type JobPdfOrigin} from '../schema/jobPdfSourceSchema';
import {splitJobRequirements} from './jobRequirements';

export type JobPdfExtractedPage={page:number;text:string;hasColumns:boolean};
export type JobPdfDraft={fileName:string;sha256:string;pages:JobPdfExtractedPage[]};

/** Never silently truncate or fill an unextractable page with fabricated text. */
export function prepareJobPdfSource(draft:JobPdfDraft,selected:readonly number[]):{source:string;origin:JobPdfOrigin}{
  const wanted=new Set(selected);
  if(!wanted.size||wanted.size!==selected.length||draft.pages.some((p,i)=>p.page!==i+1)||selected.some(n=>!draft.pages.some(p=>p.page===n)))throw new Error('请选择有效且不重复的公告页。');
  const ranges:JobPdfOrigin['pages']=[];
  const parts:string[]=[];
  let length=0;
  for(const p of draft.pages){
    if(!wanted.has(p.page))continue;
    if(!p.text.trim()||p.text.includes('\uFFFD'))throw new Error('第 '+p.page+' 页无可靠文本层，请对照原件后手工录入或明确排除该页。');
    // Textareas represent line endings as LF; bind the exact text actually shown in the editor.
    const text=p.text.replace(/\r\n?|\n/g,'\n');
    const start=length+(parts.length?1:0);length=start+text.length;
    if(length>MAX_JOB_PDF_TEXT)throw new Error('所选页超过 20000 字符，请减少页数；没有截断。');
    parts.push(text);ranges.push({page:p.page,start,end:length});
  }
  const source=parts.join('\n'),origin=JobPdfOriginSchema.parse({version:1,fileName:draft.fileName,sha256:draft.sha256,totalPages:draft.pages.length,pages:ranges});
  if(!validJobPdfOrigin(source,origin))throw new Error('公告来源映射无效。');
  if(!splitJobRequirements(source).length)throw new Error('所选页没有可核对条款。');
  return {source,origin};
}
