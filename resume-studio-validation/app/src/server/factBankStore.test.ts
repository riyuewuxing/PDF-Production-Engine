// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {LocalResumeStore} from './localFsApi';
import {FactBankStore} from './factBankStore';
import {ResumeDocumentSchema,resumeRevision,type ResumeDocument} from '../schema/resumeSchema';
import {type AddFactInput} from '../schema/factBankSchema';
import {isShareableFact} from '../lib/aiContext';
import {prepareAssistantTask} from '../lib/aiAssistant';

const fixture=()=>ResumeDocumentSchema.parse({
  id:'synthetic-doc',title:'合成测试',createdAt:'2026-01-01',updatedAt:'2026-01-01',
  basic:{name:'演示甲',email:'candidate@example.invalid'},menuSections:[{id:'basic',title:'Basic',order:0},{id:'experience',title:'Experience',order:1}],
  experience:[{id:'synthetic-exp',company:'示例机构',position:'示例助理',startDate:'2025.01',endDate:'2025.06',description:'整理实验记录。'},
    {id:'hidden',company:'HIDDEN_ENTITY',visible:false}],globalSettings:{},
});
let root:string,store:LocalResumeStore,bank:FactBankStore,doc:ResumeDocument;
let input:AddFactInput;
beforeEach(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-facts-'));
  store=new LocalResumeStore(root);bank=new FactBankStore(store);
  doc=await store.saveResume('synthetic',fixture());
  input={slug:'synthetic',docRevision:resumeRevision(doc),blockKey:'exp:synthetic-exp',bankRevision:'empty-v1',confirmation:'CONFIRM_SELF_REPORTED_FACT',
    fact:{kind:'achievement',assertion:'整理合成记录 12 份。',value:'12',unit:'份',timeframe:'2025.01-2025.06',evidenceRef:'LOCAL_ONLY_EVIDENCE_REF',sensitivity:'shareable'}};
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
describe('independent local fact bank',()=>{
  it('starts empty without writing, confirms and persists a separate stable record without mutating resume',async()=>{
    expect(await bank.get()).toEqual({schemaVersion:1,revision:'empty-v1',records:[]});
    await expect(fs.access(path.join(root,'.fact-bank-v1.json'))).rejects.toThrow();
    const result=await bank.add(input),record=result.records[0]!;
    expect(record).toMatchObject({docId:doc.id,blockKey:input.blockKey,verifiedStatus:'user-confirmed',sourceScope:'manual'});
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);expect(result.revision).not.toBe('empty-v1');
    expect(await new FactBankStore(new LocalResumeStore(root)).get()).toEqual(result);
    expect(await store.getResume('synthetic')).toEqual(doc);
    expect(JSON.stringify(doc)).not.toContain('LOCAL_ONLY_EVIDENCE_REF');
  });
  it('requires explicit confirmation and rejects caller-supplied status, IDs and arbitrary fields',async()=>{
    for(const x of [{...input,confirmation:'no'},{...input,fact:{...input.fact,verifiedStatus:'user-confirmed'}},{...input,fact:{...input.fact,id:'override'}},{...input,fact:{...input.fact,evidenceRef:''}}])await expect(bank.add(x)).rejects.toThrow();
    expect((await bank.get()).records).toHaveLength(0);
  });
  it('serializes concurrent bank writes and refuses a stale bank revision without losing records',async()=>{
    const [a,b]=await Promise.allSettled([bank.add(input),new FactBankStore(new LocalResumeStore(root)).add(input)]);
    expect([a,b].filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect([a,b].filter(x=>x.status==='rejected')).toHaveLength(1);
    expect((await bank.get()).records).toHaveLength(1);
    await expect(bank.add(input)).rejects.toThrow('事实库已被其他操作更新');
  });
  it('rejects a stale resume revision, hidden target and invalid slug',async()=>{
    await expect(bank.add({...input,docRevision:'stale'})).rejects.toThrow('关联简历已变化');
    await expect(bank.add({...input,blockKey:'exp:hidden'})).rejects.toThrow('唯一可见段落');
    await expect(bank.add({...input,slug:'../synthetic'})).rejects.toThrow();
    expect((await bank.get()).records).toHaveLength(0);
  });
  it('revokes by CAS while preserving source history and disallows reuse',async()=>{
    const saved=await bank.add(input),r=saved.records[0]!;
    await expect(bank.revoke({id:r.id,bankRevision:'empty-v1',confirmation:'REVOKE_FACT'})).rejects.toThrow();
    const revoked=await bank.revoke({id:r.id,bankRevision:saved.revision,confirmation:'REVOKE_FACT'});
    expect(revoked.records[0]).toMatchObject({...r,modifiedAt:expect.any(String),verifiedStatus:'revoked'});
    expect(isShareableFact(doc,revoked.records[0]!)).toBe(false);
    await expect(bank.revoke({id:r.id,bankRevision:revoked.revision,confirmation:'REVOKE_FACT'})).rejects.toThrow();
  });
  it('checks persisted scope and exact outbound record payload at the main-process boundary',async()=>{
    const saved=await bank.add(input),r=saved.records[0]!;
    const binding={slug:'synthetic',docId:doc.id,bankRevision:saved.revision,ids:[r.id],selectedKeys:[r.blockKey]};
    const args={document:doc,mode:'ask' as const,goal:'检查事实',keys:[r.blockKey],overflowPx:0,records:[r]};
    const prompt=prepareAssistantTask(args).options.userPrompt;
    await expect(bank.assertCurrentBinding(binding,prompt)).resolves.toBeUndefined();
    for(const bad of [{...binding,docId:'other'},{...binding,ids:[r.id,r.id]},{...binding,bankRevision:'empty-v1'},{...binding,selectedKeys:[]}])await expect(bank.assertCurrentBinding(bad,prompt)).rejects.toThrow();
    const missing=prepareAssistantTask({...args,records:[]}).options.userPrompt;
    await expect(bank.assertCurrentBinding(binding,missing)).rejects.toThrow('事实外发清单');
    await expect(bank.assertCurrentBinding(binding,prompt.replace('整理合成记录 12 份','虚构成果'))).rejects.toThrow('事实外发清单');
    await expect(bank.assertCurrentBinding(binding,prompt.replace('"scope": "record"','"scope": "master"'))).rejects.toThrow('事实外发清单');
    await store.saveResume('synthetic',{...doc,experience:doc.experience.map(e=>({...e,company:'Changed entity'}))});
    await expect(bank.assertCurrentBinding(binding,prompt)).rejects.toThrow('事实主体');
    const revoked=await bank.revoke({id:r.id,bankRevision:saved.revision,confirmation:'REVOKE_FACT'});
    await expect(bank.assertCurrentBinding(binding,prompt)).rejects.toThrow('事实库已被其他操作更新');
    await expect(bank.assertCurrentBinding({...binding,bankRevision:revoked.revision},prompt)).rejects.toThrow('事实主体');
  });
  it('corrects a fact atomically, retains its original evidence and invalidates prior approvals',async()=>{
    const saved=await bank.add(input),old=saved.records[0]!;
    const correctedInput={...input,bankRevision:saved.revision,supersedesId:old.id,fact:{...input.fact,assertion:'修正后的合成记录',sensitivity:'local-only' as const}};
    await expect(bank.add({...correctedInput,bankRevision:'empty-v1'})).rejects.toThrow();
    const corrected=await bank.add(correctedInput);
    expect(corrected.records).toHaveLength(2);
    expect(corrected.records[0]).toMatchObject({id:old.id,assertion:old.assertion,evidenceRef:old.evidenceRef,verifiedStatus:'revoked'});
    expect(corrected.records[1]).toMatchObject({supersedesId:old.id,verifiedStatus:'user-confirmed',assertion:'修正后的合成记录'});
    expect(corrected.records[1]!.id).not.toBe(old.id);
    expect(isShareableFact(doc,corrected.records[1]!)).toBe(false);
    await expect(bank.add({...correctedInput,bankRevision:corrected.revision})).rejects.toThrow('原事实已撤销');
    expect(await bank.get()).toEqual(corrected);
  });
  it('fails closed on corrupted data and does not overwrite the source file',async()=>{
    const f=path.join(root,'.fact-bank-v1.json');await fs.writeFile(f,'BROKEN');
    await expect(bank.get()).rejects.toThrow('事实库损坏');
    await expect(bank.add(input)).rejects.toThrow();
    expect(await fs.readFile(f,'utf8')).toBe('BROKEN');
  });
  it('keeps records out of default AI payloads and only includes explicitly selected facts with request aliases',async()=>{
    const saved=await bank.add({...input,fact:{...input.fact,assertion:'演示甲 整理合成记录 12 份。'}});
    const r=saved.records[0]!;
    const args={document:doc,mode:'ask' as const,goal:'检查事实',keys:[r.blockKey],overflowPx:0};
    const defaultTask=prepareAssistantTask(args);
    expect(defaultTask.options.userPrompt).not.toContain('整理合成记录 12 份');
    const selected=prepareAssistantTask({...args,records:[r]});
    expect(selected.options.userPrompt).toContain('整理合成记录 12 份');
    expect(selected.options.userPrompt).toContain('record-1');
    for(const secret of [r.id,r.docId,r.blockKey,r.entityId,r.evidenceRef,'演示甲','candidate@example.invalid'])expect(selected.options.userPrompt).not.toContain(secret);
    expect(selected.sourceMap[r.blockKey]?.some(s=>s.scope==='record'&&s.status==='user-confirmed')).toBe(true);
  });
  it('refuses sensitive, revoked, cross-document, hidden, changed subject and unselected facts',async()=>{
    const r=(await bank.add(input)).records[0]!;
    const args={document:doc,mode:'ask' as const,goal:'检查事实',keys:[r.blockKey],overflowPx:0};
    for(const record of [{...r,sensitivity:'local-only' as const},{...r,verifiedStatus:'revoked' as const},{...r,docId:'different'}])expect(()=>prepareAssistantTask({...args,records:[record]})).toThrow();
    const revised={...doc,experience:doc.experience.map(e=>({...e,company:'Changed entity'}))};
    expect(()=>prepareAssistantTask({...args,document:revised,records:[r]})).toThrow();
    expect(()=>prepareAssistantTask({...args,keys:[],records:[r]})).toThrow();
    expect(()=>prepareAssistantTask({...args,records:[r,r]})).toThrow();
    expect(isShareableFact({...doc,experience:doc.experience.map(e=>({...e,visible:false}))},r)).toBe(false);
    expect(isShareableFact({...doc,experience:doc.experience.map(e=>({...e,description:'改写正文'}))},r)).toBe(true);
  });
});
