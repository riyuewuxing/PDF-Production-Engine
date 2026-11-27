// @vitest-environment node
import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {LocalResumeStore} from './localFsApi';
import {comparisonFixture} from '../lib/comparisonSyntheticFixture';
import {prepareJobQueueTask} from '../lib/jobQueueBinding';
import {verifyQueueWorkflowOpen} from '../lib/jobQueueWorkflow';
import {jobReviewBasisHash,splitJobRequirements,blankRequirementReview} from '../lib/jobRequirements';
import {parsePracticeKey,preparePracticeQuestions,practiceHistory} from '../lib/interviewPractice';
import {JobApplicationSchema,JobReviewArchiveSchema,SavedCoverLetterSchema,type JobQueueTask,type ApplicationsStoreData} from '../schema/applicationSchema';
import type {ResumeDocument} from '../schema/resumeSchema';
import {PdfReceiptVault} from '../../electron/pdfReceipt';

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(r=>fs.rm(r,{recursive:true,force:true})));});
const jd='  必须具备教师资格。\n硕士优先。  ';
const signal=()=>new AbortController().signal;
const pdf=Buffer.from('%PDF-1.7\nsynthetic scope unit fixture\n%%EOF\n');
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-queue-workflow-'));roots.push(root);
  const store=new LocalResumeStore(path.join(root,'data'));
  const a=await store.saveResume('demo-a',{...comparisonFixture(),id:'synthetic-workflow-a'}),b=await store.saveResume('demo-b',{...comparisonFixture(),id:'synthetic-workflow-b'});
  const make=(document:ResumeDocument,slug:string,company:string)=>prepareJobQueueTask({id:randomUUID(),company,role:'物理教师',jdText:jd,slug,createdAt:new Date().toISOString()},document);
  const x=await make(a,'demo-a','合成甲校'),y=await make(a,'demo-a','合成乙校'),z=await make(b,'demo-b','合成丙校'),pending=await make(a,'demo-a','合成未准备学校');
  const base=await store.getApplications();
  let ledger=await store.saveApplications({...base,jobQueue:[x,y,z,pending]},base.revision);
  const prepared:JobQueueTask[]=[];
  for(const t of [x,y,z]){
    const started=await store.commandJobQueue({taskId:t.id,ledgerRevision:ledger.revision!,action:'start'});
    const result=await store.prepareJobQueueAttempt(started.started!,signal());
    ledger=await store.finishJobQueueAttempt(t.id,started.started!.execution!.attemptId!,{result});
    prepared.push(ledger.jobQueue!.find(row=>row.id===t.id)!);
  }
  const file=path.join(root,'synthetic.pdf');await fs.writeFile(file,pdf);
  const vault=new PdfReceiptVault();
  const issue=(t:JobQueueTask,doc:ResumeDocument)=>vault.issue(file,t.slug,doc,pdf,undefined,undefined,t.id);
  const archive=async(t:JobQueueTask,doc:ResumeDocument)=>JobReviewArchiveSchema.parse({reviewVersion:1,id:randomUUID(),queueTaskId:t.id,slug:t.slug,docId:t.docId,documentRevision:t.documentRevision,factRevision:null,basisHash:await jobReviewBasisHash(doc,null,t.jdText),source:t.jdText,createdAt:new Date().toISOString(),applicationId:null,snapshotId:null,rows:[{clauseId:splitJobRequirements(t.jdText)[0]!.id,review:blankRequirementReview()}]});
  const letter=(t:JobQueueTask)=>SavedCoverLetterSchema.parse({id:randomUUID(),queueTaskId:t.id,company:t.company,role:t.role,resumeSlug:t.slug,title:'合成自荐信',bodyText:'本人核对稿',headerVariant:'classic-line'});
  const entry=(t:JobQueueTask)=>JobApplicationSchema.parse({id:randomUUID(),queueTaskId:t.id,company:t.company,role:t.role,resumeSlug:t.slug,jdText:t.jdText,exportedFilePath:file,status:'wishlist'});
  return {root,store,a,b,x:prepared[0]!,y:prepared[1]!,z:prepared[2]!,pending,ledger,file,vault,issue,archive,letter,entry,originalA:await fs.readFile(store.resolveResumePath('demo-a').filePath),originalB:await fs.readFile(store.resolveResumePath('demo-b').filePath)};
}
const read=(f:Awaited<ReturnType<typeof fixture>>)=>fs.readFile(f.store.applicationsPath);
const open=(t:JobQueueTask,l:ApplicationsStoreData)=>({taskId:t.id,ledgerRevision:l.revision!});
describe('explicit prepared workflow gate',()=>{
  it('reads exact prepared task only, refuses wrong or old identity and does not write formal files',async()=>{
    const f=await fixture(),before=await read(f);
    const opened=await f.store.openPreparedJobQueue(open(f.x,f.ledger));
    expect(opened).toEqual({task:f.x,document:f.a,ledgerRevision:f.ledger.revision});
    expect(await verifyQueueWorkflowOpen(opened,f.x,f.ledger.revision!,'demo-a',f.a)).toEqual(opened);
    await expect(verifyQueueWorkflowOpen(opened,f.y,f.ledger.revision!,'demo-a',f.a)).rejects.toThrow();
    await expect(verifyQueueWorkflowOpen(opened,f.x,f.ledger.revision!,'demo-b',f.b)).rejects.toThrow();
    await expect(verifyQueueWorkflowOpen(opened,f.x,f.ledger.revision!,'demo-a',{...f.a,title:'内存未保存'})).rejects.toThrow();
    await expect(f.store.openPreparedJobQueue(open(f.pending,f.ledger))).rejects.toMatchObject({code:'JOB_QUEUE_NOT_PREPARED'});
    await expect(f.store.openPreparedJobQueue({...open(f.x,f.ledger),ledgerRevision:'0'.repeat(64)})).rejects.toMatchObject({code:'APPLICATION_CONFLICT'});
    await expect(f.store.openPreparedJobQueue({...open(f.x,f.ledger),slug:'demo-b'})).rejects.toMatchObject({code:'JOB_QUEUE_COMMAND'});
    expect(await read(f)).toEqual(before);expect(await fs.readFile(f.store.resolveResumePath('demo-a').filePath)).toEqual(f.originalA);
  });
  it('refuses a schema-valid but false persisted preparation receipt and same-revision source changes',async()=>{
    const f=await fixture();
    const raw=JSON.parse((await read(f)).toString());
    raw.jobQueue[0].execution.result.jdSha256='0'.repeat(64);
    await fs.writeFile(f.store.applicationsPath,JSON.stringify(raw));const altered=await read(f),actual=await f.store.getApplications();
    await expect(f.store.openPreparedJobQueue(open(f.x,actual))).rejects.toMatchObject({code:'JOB_QUEUE_RECEIPT'});
    expect(await read(f)).toEqual(altered);
    await fs.writeFile(f.store.applicationsPath,JSON.stringify(f.ledger));
    const source=f.store.resolveResumePath('demo-a').filePath;await fs.writeFile(source,JSON.stringify({...f.a,title:'同版本内容变更'}));
    const before=await read(f),changed=await fs.readFile(source);
    await expect(f.store.openPreparedJobQueue(open(f.x,f.ledger))).rejects.toMatchObject({code:'JOB_QUEUE_STALE'});
    expect(await read(f)).toEqual(before);expect(await fs.readFile(source)).toEqual(changed);
    expect((await f.store.openPreparedJobQueue(open(f.z,f.ledger))).task).toEqual(f.z);
  });
  it('rejects canceled tasks and an aborted read without automatically re-running',async()=>{
    const f=await fixture(),canceled=await f.store.commandJobQueue({...open(f.pending,f.ledger),action:'cancel'}),before=await read(f);
    await expect(f.store.openPreparedJobQueue(open(f.pending,canceled.store))).rejects.toMatchObject({code:'JOB_QUEUE_NOT_PREPARED'});
    const abort=new AbortController();abort.abort();
    await expect(f.store.openPreparedJobQueue(open(f.x,canceled.store),abort.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(await read(f)).toEqual(before);
  });
});
describe('task-scoped material persistence',()=>{
  it('isolates same-doc, same-JD, same-role interview keys and archives; validates new writes',async()=>{
    const f=await fixture(),a=await f.archive(f.x,f.a),b=await f.archive(f.y,f.a),l=f.letter(f.x);
    const x=await preparePracticeQuestions(f.a,f.x.slug,f.x.role,undefined,f.x.id),y=await preparePracticeQuestions(f.a,f.y.slug,f.y.role,undefined,f.y.id),ordinary=await preparePracticeQuestions(f.a,f.x.slug,f.x.role);
    expect(x.length).toBeGreaterThan(0);expect(x[0]!.answerKey).not.toBe(y[0]!.answerKey);expect(x[0]!.answerKey).not.toBe(ordinary[0]!.answerKey);
    expect(parsePracticeKey(x[0]!.answerKey)?.queueTaskId).toBe(f.x.id);
    const answers={[x[0]!.answerKey]:'甲答案',[y[0]!.answerKey]:'乙答案',[ordinary[0]!.answerKey]:'通用答案'};
    expect(practiceHistory(answers,f.a.id,f.x.slug,x,f.x.id).history).toEqual([]);
    expect(practiceHistory(answers,f.a.id,f.x.slug,ordinary).history).toEqual([]);
    await expect(preparePracticeQuestions(f.a,f.x.slug,f.x.role,b,f.x.id)).rejects.toThrow();
    const saved=await f.store.saveApplications({...f.ledger,jobReviews:[a,b],coverLetters:[l],interviewAnswers:answers},f.ledger.revision);
    expect(saved.jobReviews).toEqual([a,b]);expect(saved.coverLetters).toEqual([l]);expect(saved.interviewAnswers).toEqual(answers);
    const before=await read(f);
    await expect(f.store.saveApplications({...saved,coverLetters:[{...l,queueTaskId:f.y.id}]},saved.revision)).rejects.toMatchObject({code:'JOB_QUEUE_LINK'});
    await expect(f.store.saveApplications({...saved,jobReviews:[{...a,queueTaskId:f.y.id},b]},saved.revision)).rejects.toMatchObject({code:'JOB_REVIEW_IMMUTABLE'});
    const wrongKey=(await preparePracticeQuestions(f.b,f.z.slug,f.z.role,undefined,f.x.id))[0]!.answerKey;
    await expect(f.store.saveApplications({...saved,interviewAnswers:{...answers,[wrongKey]:'串岗草稿'}},saved.revision)).rejects.toMatchObject({code:'JOB_QUEUE_LINK'});
    await expect(f.store.saveApplications({...saved,coverLetters:[l,f.letter(f.pending)]},saved.revision)).rejects.toMatchObject({code:'JOB_QUEUE_NOT_PREPARED'});
    expect(await read(f)).toEqual(before);
  });
  it('requires original PDF receipt, protects application identity and rejects generic creation or linking to another task',async()=>{
    const f=await fixture(),issued=await f.issue(f.x,f.a),entry=f.entry(f.x),input={entry,document:f.a,pdfReceiptToken:issued.pdfReceiptToken};
    const before=await read(f);
    expect(()=>f.vault.resolve(issued.pdfReceiptToken,f.file,f.x.slug,f.a,f.y.id)).toThrow();
    expect(()=>f.vault.resolve(issued.pdfReceiptToken,f.file,f.x.slug,f.a)).toThrow();
    expect(f.vault.resolve(issued.pdfReceiptToken,f.file,f.x.slug,f.a,f.x.id)).toEqual(issued.pdfReceipt);
    await expect(f.store.logApplication({entry,document:f.a})).rejects.toMatchObject({code:'JOB_QUEUE_LINK'});
    await expect(f.store.logApplication({...input,entry:{...entry,company:f.y.company}},issued.pdfReceipt)).rejects.toMatchObject({code:'JOB_QUEUE_LINK'});
    await expect(f.store.saveApplications({...f.ledger,applications:[entry]},f.ledger.revision)).rejects.toMatchObject({code:'JOB_QUEUE_LINK'});
    expect(await read(f)).toEqual(before);
    const saved=await f.store.logApplication(input,issued.pdfReceipt);
    const snap=await f.store.getLinkedApplicationSnapshot({applicationId:entry.id,snapshotId:saved.entry.snapshotId,ledgerRevision:saved.store.revision!});
    expect(snap.meta.queueTaskId).toBe(f.x.id);expect(snap.document).toEqual(f.a);expect(saved.entry.status).toBe('wishlist');
    expect((await f.store.logApplication(input,issued.pdfReceipt)).store.applications).toHaveLength(1);
    await expect(f.store.logApplication({...input,entry:{...entry,queueTaskId:f.y.id,company:f.y.company}},issued.pdfReceipt)).rejects.toMatchObject({code:'JOB_QUEUE_LINK'});
    await expect(f.store.saveApplications({...saved.store,applications:[{...saved.entry,queueTaskId:f.y.id,company:f.y.company}]},saved.store.revision)).rejects.toMatchObject({code:'JOB_QUEUE_LINK'});
    const a=await f.archive(f.y,f.a);
    await expect(f.store.saveApplications({...saved.store,jobReviews:[{...a,applicationId:entry.id,snapshotId:saved.entry.snapshotId}]},saved.store.revision)).rejects.toMatchObject({code:'JOB_REVIEW_LINK'});
    const correct=await f.archive(f.x,f.a),review=await f.store.saveApplications({...saved.store,jobReviews:[{...correct,applicationId:entry.id,snapshotId:saved.entry.snapshotId}]},saved.store.revision);
    expect(review.jobReviews?.[0]?.queueTaskId).toBe(f.x.id);
    expect(await fs.readFile(f.store.resolveResumePath('demo-a').filePath)).toEqual(f.originalA);expect(await fs.readFile(f.store.resolveResumePath('demo-b').filePath)).toEqual(f.originalB);
  });
  it('keeps an orphan snapshot tied to the first task after an atomic ledger write failure; exact retry is recoverable',async()=>{
    const f=await fixture(),issued=await f.issue(f.x,f.a),entry=f.entry(f.x),input={entry,document:f.a,pdfReceiptToken:issued.pdfReceiptToken},before=await read(f);
    const rename=fs.rename.bind(fs),inject=vi.spyOn(fs,'rename').mockImplementation(async(a,b)=>{if(String(b)===f.store.applicationsPath)throw Object.assign(Error('synthetic ENOSPC'),{code:'ENOSPC'});return rename(a,b);});
    await expect(f.store.logApplication(input,issued.pdfReceipt)).rejects.toThrow('synthetic ENOSPC');expect(await read(f)).toEqual(before);
    const snap=await f.store.getApplicationSnapshot('app-'+entry.id);expect(snap.meta.queueTaskId).toBe(f.x.id);inject.mockRestore();
    await expect(f.store.logApplication({...input,entry:{...entry,queueTaskId:f.y.id,company:f.y.company}},issued.pdfReceipt)).rejects.toMatchObject({code:'SNAPSHOT_EXISTS'});
    const saved=await f.store.logApplication(input,issued.pdfReceipt);expect(saved.store.applications).toHaveLength(1);expect(saved.entry.queueTaskId).toBe(f.x.id);
  });
  it('retains historical linked material after source change, blocks new scoped writes and leaves unrelated edits possible',async()=>{
    const f=await fixture(),issued=await f.issue(f.x,f.a),entry=f.entry(f.x),saved=await f.store.logApplication({entry,document:f.a},issued.pdfReceipt),l=f.letter(f.x);
    const ledger=await f.store.saveApplications({...saved.store,coverLetters:[l]},saved.store.revision);
    const original=await read(f),pathA=f.store.resolveResumePath('demo-a').filePath;
    await fs.writeFile(pathA,JSON.stringify({...f.a,title:'外部同版本变更'}));
    await expect(f.store.saveApplications({...ledger,coverLetters:[l,f.letter(f.x)]},ledger.revision)).rejects.toMatchObject({code:'JOB_QUEUE_STALE'});
    await expect(f.store.logApplication({entry:f.entry(f.x),document:f.a},issued.pdfReceipt)).rejects.toMatchObject({code:'JOB_QUEUE_STALE'});
    expect(await read(f)).toEqual(original);
    const historical=await f.store.getLinkedApplicationSnapshot({applicationId:entry.id,snapshotId:saved.entry.snapshotId,ledgerRevision:ledger.revision!});
    expect(historical.document).toEqual(f.a);expect(historical.meta.queueTaskId).toBe(f.x.id);
    const edited=await f.store.saveApplications({...ledger,applications:[{...saved.entry,notes:'本人复盘'}],interviewAnswers:{ordinary:'普通草稿'}},ledger.revision);
    expect(edited.coverLetters).toEqual([l]);expect(edited.applications[0]?.queueTaskId).toBe(f.x.id);
  });
  it('refuses altered historical queue snapshot association even with matching PDF and document',async()=>{
    const f=await fixture(),issued=await f.issue(f.x,f.a),entry=f.entry(f.x),saved=await f.store.logApplication({entry,document:f.a},issued.pdfReceipt);
    const file=path.join(f.store.appSnapshotsDir,saved.entry.snapshotId+'.json'),raw=JSON.parse(await fs.readFile(file,'utf8'));
    await fs.writeFile(file,JSON.stringify({...raw,meta:{...raw.meta,queueTaskId:f.y.id}}));
    const before=await read(f);
    await expect(f.store.getLinkedApplicationSnapshot({applicationId:entry.id,snapshotId:saved.entry.snapshotId,ledgerRevision:saved.store.revision!})).rejects.toMatchObject({code:'APPLICATION_SNAPSHOT_LINK'});
    expect(await read(f)).toEqual(before);
  });
});
