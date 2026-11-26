import type {ResumeDocument} from '../schema/resumeSchema';
import type {FactRecord,FactRequestBinding} from '../schema/factBankSchema';
import {collectAiToolContext} from './aiSkills';

type Obj=Record<string,unknown>;
const obj=(v:unknown):v is Obj=>typeof v==='object'&&v!==null&&!Array.isArray(v);
function readPrompt(prompt:string):unknown{
  try{return JSON.parse(prompt);}catch{return null;}
}
function readRecords(value:unknown):{blockKey:unknown;source:unknown}[]{
  if(!obj(value))return [];
  // Single polish and assistant use toolResults; whole-resume tailoring uses blocks.
  // Inspect both, so duplicating or moving records into a second supported container cannot bypass the gate.
  const rows:unknown[]=[
    ...(obj(value.toolResults)&&Array.isArray(value.toolResults.inspect_block_facts)?value.toolResults.inspect_block_facts:[]),
    ...(Array.isArray(value.blocks)?value.blocks:[]),
  ];
  return rows.flatMap((row:unknown)=>{
    if(!obj(row)||!Array.isArray(row.sources))return [];
    return row.sources.filter((source:unknown)=>obj(source)&&(source.scope==='record'||(typeof source.id==='string'&&source.id.startsWith('record-')))).map((source:unknown)=>({blockKey:row.blockKey,source}));
  });
}
/** Detect record sources in the structured assistant payload, not arbitrary natural-language text. */
export function hasRecordFactSources(prompt:string):boolean{
  return readRecords(readPrompt(prompt)).length>0;
}
/** Bind each request alias to the same persisted fact, selected block and sanitized content.
 * The local binding is stripped before transport; user-facing preview remains exact.
 */
export function assertBoundFactPrompt(doc:ResumeDocument,binding:FactRequestBinding,records:readonly FactRecord[],prompt:string,master?:ResumeDocument|null):void{
  const expected=readRecords({toolResults:collectAiToolContext(doc,binding.selectedKeys,0,records,master?[master]:[]).toolResults});
  const actual=readRecords(readPrompt(prompt));
  if(expected.length!==records.length||JSON.stringify(actual)!==JSON.stringify(expected))
    throw new Error('事实外发清单与本地授权记录不一致，拒绝发送。');
}
