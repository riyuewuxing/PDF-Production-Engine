// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {LocalResumeStore} from './localFsApi';
import {FactBankStore} from './factBankStore';
import {EvidenceStore} from './evidenceStore';
import {ResumeDocumentSchema,resumeRevision,type ResumeDocument} from '../schema/resumeSchema';
import {MAX_EVIDENCE_FILE_BYTES,MAX_EVIDENCE_VAULT_BYTES,type AttachEvidenceInput,type EvidenceEntry} from '../schema/evidenceSchema';
import {prepareAssistantTask} from '../lib/aiAssistant';

const fixture=()=>ResumeDocumentSchema.parse({
  id:'synthetic-evidence-doc',title:'合成证据测试',createdAt:'2026-01-01',updatedAt:'2026-01-01',
  basic:{name:'演示甲',email:'fixture@example.invalid'},menuSections:[{id:'basic',title:'Basic',order:0},{id:'experience',title:'Experience',order:1}],
  experience:[{id:'synthetic-exp',company:'示例机构',position:'示例助理',startDate:'2025.01',endDate:'2025.06',description:'整理实验记录。'}],globalSettings:{},
});
let root:string,store:LocalResumeStore,facts:FactBankStore,evidence:EvidenceStore,doc:ResumeDocument,input:AttachEvidenceInput,source:string;
const bytes=Buffer.from('SYNTHETIC_ATTACHMENT_CONTENT\n合成来源文件。\n','utf8');
const file=(e:EvidenceEntry)=>path.join(store.dataDir,'.evidence-files-v1',e.id+'.'+e.kind);
beforeEach(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-evidence-'));
  store=new LocalResumeStore(path.join(root,'data'));facts=new FactBankStore(store);evidence=new EvidenceStore(store,facts);
  doc=await store.saveResume('synthetic',fixture());
  const bank=await facts.add({slug:'synthetic',docRevision:resumeRevision(doc),blockKey:'exp:synthetic-exp',bankRevision:'empty-v1',confirmation:'CONFIRM_SELF_REPORTED_FACT',
    fact:{kind:'achievement',assertion:'整理合成记录 12 份。',value:'12',unit:'份',timeframe:'2025.01-2025.06',evidenceRef:'LOCAL_REFERENCE',sensitivity:'shareable'}});
  input={slug:'synthetic',docRevision:resumeRevision(doc),factId:bank.records[0]!.id,bankRevision:bank.revision,indexRevision:'empty-v1',note:'SYNTHETIC_LOCAL_NOTE',confirmation:'CONFIRM_LOCAL_EVIDENCE_COPY'};
  source=path.join(root,'synthetic-private-note.txt');await fs.writeFile(source,bytes);
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
describe('isolated evidence vault',()=>{
  it('does not create storage on read, imports an exact independent copy and persists only local metadata',async()=>{
    expect(await evidence.get()).toEqual({schemaVersion:1,revision:'empty-v1',entries:[]});
    await expect(fs.access(path.join(store.dataDir,'.evidence-index-v1.json'))).rejects.toThrow();
    await expect(fs.access(path.join(store.dataDir,'.evidence-files-v1'))).rejects.toThrow();
    const before=await facts.get();
    await expect(evidence.assertAttachAllowed(input)).resolves.toBeUndefined();
    const index=await evidence.attachSelectedFile(input,source),entry=index.entries[0]!;
    expect(entry).toMatchObject({factId:input.factId,docId:doc.id,originalName:'synthetic-private-note.txt',kind:'txt',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),note:input.note,status:'attached'});
    expect(await fs.readFile(file(entry))).toEqual(bytes);
    expect(await fs.readFile(source)).toEqual(bytes);
    expect(await new EvidenceStore(new LocalResumeStore(store.dataDir)).get()).toEqual(index);
    expect(JSON.stringify(index)).not.toContain(root);
    expect(JSON.stringify(index)).not.toContain('SYNTHETIC_ATTACHMENT_CONTENT');
    expect(await store.getResume('synthetic')).toEqual(doc);expect(await facts.get()).toEqual(before);
    const prompt=prepareAssistantTask({document:doc,mode:'ask',goal:'检查',keys:['exp:synthetic-exp'],overflowPx:0,records:before.records}).options.userPrompt;
    for(const s of [entry.id,entry.sha256,entry.note,entry.originalName,'SYNTHETIC_ATTACHMENT_CONTENT',source])expect(prompt).not.toContain(s);
    await expect(evidence.verify({id:entry.id,indexRevision:index.revision})).resolves.toMatchObject({state:'intact'});
    expect(await evidence.revealPath({id:entry.id,indexRevision:index.revision})).toBe(file(entry));
  });
  it('requires consent and current versions, rejects injection, duplicate content and invalid fact targets',async()=>{
    for(const raw of [{...input,confirmation:'no'},{...input,selectedPath:source},{...input,factId:'00000000-0000-4000-8000-000000000000'},{...input,docRevision:'old'},{...input,bankRevision:'old'},{...input,indexRevision:'old'}])
      await expect(evidence.attachSelectedFile(raw,source)).rejects.toThrow();
    const index=await evidence.attachSelectedFile(input,source);
    await expect(evidence.attachSelectedFile({...input,indexRevision:index.revision},source)).rejects.toThrow('相同内容');
    const saved=await facts.revoke({id:input.factId,bankRevision:input.bankRevision,confirmation:'REVOKE_FACT'});
    await expect(evidence.assertAttachAllowed({...input,bankRevision:saved.revision,indexRevision:index.revision})).rejects.toThrow('有效原始事实');
    expect(await evidence.get()).toEqual(index);
  });
  it('rejects changed document and linked copies as attachment owners',async()=>{
    const bank=await facts.get();
    const target=await store.saveResume('target',{...doc,id:'synthetic-target',title:'合成派生版'});
    const linked=await facts.link({slug:'target',docRevision:resumeRevision(target),sourceId:input.factId,bankRevision:bank.revision,confirmation:'CONFIRM_SAME_ENTITY_FACT_LINK'});
    await expect(evidence.attachSelectedFile({...input,slug:'target',docRevision:resumeRevision(target),bankRevision:linked.revision,factId:linked.records[1]!.id},source)).rejects.toThrow('有效原始事实');
    const updated=await store.saveResume('synthetic',{...doc,experience:doc.experience.map(e=>({...e,company:'Changed subject'}))});
    await expect(evidence.attachSelectedFile({...input,docRevision:resumeRevision(updated),bankRevision:linked.revision},source)).rejects.toThrow('有效原始事实');
    expect((await evidence.get()).entries).toHaveLength(0);
  });
  it('validates allowed signatures, rejects unknown extension, malformed text, empty and oversized file',async()=>{
    const bad=[['synthetic.exe',bytes],['fake.pdf',bytes],['fake.png',bytes],['invalid.txt',Buffer.from([255,0,1])],['empty.txt',Buffer.alloc(0)]] as const;
    for(const [name,value] of bad){const src=path.join(root,name);await fs.writeFile(src,value);await expect(evidence.attachSelectedFile(input,src)).rejects.toThrow();}
    const oversized=path.join(root,'oversized.txt');const handle=await fs.open(oversized,'w');try{await handle.truncate(MAX_EVIDENCE_FILE_BYTES+1);}finally{await handle.close();}
    await expect(evidence.attachSelectedFile(input,oversized)).rejects.toThrow();
    await expect(evidence.attachSelectedFile(input,root)).rejects.toThrow();
    const pdf=path.join(root,'synthetic.pdf');await fs.writeFile(pdf,'%PDF-1.7\n% synthetic signature fixture\n');
    const idx=await evidence.attachSelectedFile(input,pdf);
    expect(idx.entries[0]?.kind).toBe('pdf');
  });
  it('detects same-size tampering, missing file and refuses reveal; verifies copied bytes not original path',async()=>{
    const index=await evidence.attachSelectedFile(input,source),entry=index.entries[0]!,read={id:entry.id,indexRevision:index.revision};
    await fs.writeFile(source,'changed original');
    expect((await evidence.verify(read)).state).toBe('intact');
    await fs.writeFile(file(entry),Buffer.alloc(entry.size,65));
    expect((await evidence.verify(read)).state).toBe('changed');
    await expect(evidence.revealPath(read)).rejects.toThrow('副本缺失、已变化或不可读');
    await fs.unlink(file(entry));
    expect((await evidence.verify(read)).state).toBe('missing');
    await expect(evidence.revealPath({...read,id:'../arbitrary'})).rejects.toThrow();
    await expect(evidence.verify({...read,indexRevision:'old'})).rejects.toThrow('索引已变化');
    expect(await evidence.get()).toEqual(index);
  });
  it('requires separate detach and purge consent, retains history and never deletes original or alters facts',async()=>{
    const before=await facts.get(),index=await evidence.attachSelectedFile(input,source),entry=index.entries[0]!;
    const read={id:entry.id,indexRevision:index.revision};
    await expect(evidence.purge({...read,confirmation:'DELETE_MANAGED_EVIDENCE_COPY'})).rejects.toThrow('先解除');
    await expect(evidence.detach({...read,confirmation:'wrong'})).rejects.toThrow();
    const detached=await evidence.detach({...read,confirmation:'DETACH_LOCAL_EVIDENCE'});
    expect(detached.entries[0]?.status).toBe('detached');
    expect(await fs.readFile(file(entry))).toEqual(bytes);
    await expect(evidence.purge({...read,confirmation:'DELETE_MANAGED_EVIDENCE_COPY'})).rejects.toThrow('索引已变化');
    const purged=await evidence.purge({id:entry.id,indexRevision:detached.revision,confirmation:'DELETE_MANAGED_EVIDENCE_COPY'});
    expect(purged.entries[0]).toMatchObject({status:'purged',sha256:entry.sha256,originalName:entry.originalName});
    await expect(fs.access(file(entry))).rejects.toThrow();
    expect(await fs.readFile(source)).toEqual(bytes);
    expect((await evidence.verify({id:entry.id,indexRevision:purged.revision})).state).toBe('purged');
    expect(await facts.get()).toEqual(before);expect(await store.getResume('synthetic')).toEqual(doc);
  });
  it('enforces concurrent revision, actual disk capacity and fails closed on corrupt index',async()=>{
    const results=await Promise.allSettled([evidence.attachSelectedFile(input,source),new EvidenceStore(new LocalResumeStore(store.dataDir)).attachSelectedFile(input,source)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const index=await evidence.get();expect(index.entries).toHaveLength(1);
    expect(await fs.readdir(path.dirname(file(index.entries[0]!)))).toHaveLength(1);
    const other=path.join(root,'other.txt');await fs.writeFile(other,'different synthetic content');
    const orphan=path.join(path.dirname(file(index.entries[0]!)),'synthetic-orphan');
    const handle=await fs.open(orphan,'w');try{await handle.truncate(MAX_EVIDENCE_VAULT_BYTES);}finally{await handle.close();}
    await expect(evidence.attachSelectedFile({...input,indexRevision:index.revision},other)).rejects.toThrow('200 MB');
    await fs.unlink(orphan);
    const indexFile=path.join(store.dataDir,'.evidence-index-v1.json');
    await fs.writeFile(indexFile,'{corrupt');
    await expect(evidence.get()).rejects.toThrow('损坏');
    await expect(evidence.attachSelectedFile({...input,indexRevision:index.revision},other)).rejects.toThrow('损坏');
    expect(await fs.readFile(indexFile,'utf8')).toBe('{corrupt');
  });
  it('reports an empty vault and reconciles missing, unexpected, residual and orphan copies without modifying them',async()=>{
    const empty=await evidence.audit();
    expect(empty).toMatchObject({exists:false,totalBytes:0,regularFiles:0,missingCopies:0,sizeMismatches:0,unsafeEntries:0,unindexedFiles:0,purgedResiduals:0});
    await expect(evidence.vaultPath()).rejects.toThrow();
    const first=await evidence.attachSelectedFile(input,source);
    const secondFile=path.join(root,'second.txt');await fs.writeFile(secondFile,'SYNTHETIC_SECOND_CONTENT');
    const second=await evidence.attachSelectedFile({...input,indexRevision:first.revision},secondFile);
    const [a,b]=second.entries;
    const vault=path.dirname(file(a!));
    expect(await evidence.vaultPath()).toBe(vault);
    expect(await evidence.audit()).toMatchObject({exists:true,regularFiles:2,missingCopies:0,unindexedFiles:0,sizeMismatches:0});
    await fs.unlink(file(a!));
    await fs.appendFile(file(b!),'modified');
    const orphan=path.join(vault,'unindexed-synthetic.txt');await fs.writeFile(orphan,'SYNTHETIC_ORPHAN');
    const abnormal=path.join(vault,'unexpected-directory');await fs.mkdir(abnormal);
    const changed=await evidence.audit();
    expect(changed).toMatchObject({regularFiles:2,missingCopies:1,sizeMismatches:1,unsafeEntries:1,unindexedFiles:1,purgedResiduals:0});
    expect(JSON.stringify(changed)).not.toContain(orphan);
    expect(await evidence.get()).toEqual(second);
    expect(await fs.readFile(orphan,'utf8')).toBe('SYNTHETIC_ORPHAN');
    const detached=await evidence.detach({id:a!.id,indexRevision:second.revision,confirmation:'DETACH_LOCAL_EVIDENCE'});
    const purged=await evidence.purge({id:a!.id,indexRevision:detached.revision,confirmation:'DELETE_MANAGED_EVIDENCE_COPY'});
    await fs.writeFile(file(a!),'SYNTHETIC_RESIDUAL');
    expect(await evidence.audit()).toMatchObject({missingCopies:0,sizeMismatches:1,unsafeEntries:1,unindexedFiles:1,purgedResiduals:1});
    expect(await fs.readFile(file(a!),'utf8')).toBe('SYNTHETIC_RESIDUAL');
    expect(await evidence.get()).toEqual(purged);
  });
  it('never recreates a lost index over existing managed copies',async()=>{
    const index=await evidence.attachSelectedFile(input,source),entry=index.entries[0]!;
    const indexFile=path.join(store.dataDir,'.evidence-index-v1.json');
    const old=await fs.readFile(indexFile);await fs.unlink(indexFile);
    expect(await evidence.audit()).toMatchObject({indexMissingWithFiles:true,unindexedFiles:1,regularFiles:1});
    await expect(evidence.assertAttachAllowed(input)).rejects.toThrow('禁止自动重建索引');
    await expect(evidence.attachSelectedFile(input,source)).rejects.toThrow('禁止自动重建索引');
    await expect(fs.access(indexFile)).rejects.toThrow();
    expect(await fs.readFile(file(entry))).toEqual(bytes);
    await fs.writeFile(indexFile,old);
    expect(await evidence.get()).toEqual(index);
    expect(await evidence.audit()).toMatchObject({indexMissingWithFiles:false,unindexedFiles:0});
  });
  it('refuses unsafe managed directory and nonregular managed file',async()=>{
    const index=await evidence.attachSelectedFile(input,source),entry=index.entries[0]!,read={id:entry.id,indexRevision:index.revision};
    await fs.unlink(file(entry));await fs.mkdir(file(entry));
    expect((await evidence.verify(read)).state).toBe('unreadable');
    await expect(evidence.revealPath(read)).rejects.toThrow();
    const detached=await evidence.detach({...read,confirmation:'DETACH_LOCAL_EVIDENCE'});
    await expect(evidence.purge({id:entry.id,indexRevision:detached.revision,confirmation:'DELETE_MANAGED_EVIDENCE_COPY'})).rejects.toThrow('不是普通文件');
    if(process.platform!=='win32'){
      await fs.rm(file(entry),{recursive:true});await fs.symlink(source,file(entry));
      expect((await evidence.verify({id:entry.id,indexRevision:detached.revision})).state).toBe('unreadable');
      await expect(evidence.purge({id:entry.id,indexRevision:detached.revision,confirmation:'DELETE_MANAGED_EVIDENCE_COPY'})).rejects.toThrow();
      expect(await fs.readFile(source)).toEqual(bytes);
    }
  });
});
