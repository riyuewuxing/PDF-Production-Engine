import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {JobCareerPane} from './JobCareerPane';
import {comparisonFixture,changedComparisonFixture} from '../../lib/comparisonSyntheticFixture';
import {JobApplicationSchema,type ApplicationsStoreData,type ApplicationSnapshotRecord} from '../../schema/applicationSchema';
import type {ResumeSummary} from '../../schema/resumeSchema';
import type {ResumeDesktopBridge} from '../../types/electron';
type State={data:ApplicationsStoreData;ready:boolean;loading:boolean;saving:boolean;dirty:boolean;error:string|null;recoveryError:string|null};
const session=vi.hoisted(()=>({state:null as unknown as State,listeners:new Set<()=>void>(),load:vi.fn(),update:vi.fn(),flush:vi.fn()}));
vi.mock('../../lib/careerLedgerSession',()=>({careerLedger:{
 getSnapshot:()=>session.state,subscribe:(listener:()=>void)=>{session.listeners.add(listener);return ()=>session.listeners.delete(listener);},
 load:session.load,update:session.update,flush:session.flush
}}));
vi.mock('./CareerAiPanel',()=>({CareerAiPanel:()=>null}));
vi.mock('./InterviewPracticePane',()=>({InterviewPracticePane:()=>null}));
const entry=JobApplicationSchema.parse({id:'application-39',company:'合成学校',role:'物理教师',resumeSlug:'origin',snapshotId:'app-archive-39',exportedFilePath:'C:/synthetic/old.pdf',atsScore:63});
const manual=JobApplicationSchema.parse({id:'manual-39',company:'手工合成记录',role:'物理教师',resumeSlug:'current'});
const read=vi.fn(),rawRead=vi.fn(),save=vi.fn(),clone=vi.fn(),openPath=vi.fn();
const revision='a'.repeat(64);
function sourceRecord():ApplicationSnapshotRecord{
 const doc=comparisonFixture();return {meta:{id:entry.snapshotId,applicationId:entry.id,resumeSlug:entry.resumeSlug,exportedFilePath:entry.exportedFilePath,atsScore:entry.atsScore,createdAt:'2026-01-01T00:00:00Z',title:doc.title,templateId:doc.templateId},document:doc};
}
function props(){
 const activeDoc=changedComparisonFixture(),summaries:ResumeSummary[]=[{slug:'current',id:activeDoc.id,title:activeDoc.title,templateId:activeDoc.templateId,updatedAt:activeDoc.updatedAt,isMaster:false}];
 return {activeSlug:'current',activeDoc,summaries,onSwitchToResumeForEdit:vi.fn(),onCloneSnapshot:clone};
}
function publish(patch:Partial<State>){session.state={...session.state,...patch};for(const f of session.listeners)f();}
function reviewButton(){return screen.getByRole('button',{name:'只读复盘 合成学校'});}
function cloneButton(){return screen.getByRole('button',{name:'克隆回工作台'});}
beforeEach(()=>{
 vi.resetAllMocks();session.listeners.clear();
 session.state={data:{schemaVersion:1,revision,applications:[entry,manual],coverLetters:[],interviewAnswers:{}},ready:true,loading:false,saving:false,dirty:false,error:null,recoveryError:null};
 session.load.mockResolvedValue(undefined);session.flush.mockResolvedValue(undefined);
 read.mockResolvedValue(sourceRecord());clone.mockResolvedValue(undefined);
 window.resumeDesktop={applications:{getLinkedSnapshot:read,getSnapshot:rawRead},resumes:{save},shell:{openPath}} as unknown as ResumeDesktopBridge;
 Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();delete window.resumeDesktop;Reflect.deleteProperty(HTMLElement.prototype,'scrollTo');vi.useRealTimers();});
describe('career permanent archive review and verified clone lifecycle',()=>{
 it('offers review only on linked persisted records and starts no read before explicit request',async()=>{
  render(<JobCareerPane {...props()}/>);expect(reviewButton()).not.toBeDisabled();expect(screen.queryByRole('button',{name:'只读复盘 手工合成记录'})).toBeNull();
  fireEvent.click(reviewButton());expect(screen.getByRole('dialog',{name:'永久投递快照只读复盘'})).toBeTruthy();expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'读取并对比'}));await screen.findByText('左 · 冻结基准（永久投递原稿）');
  expect(read).toHaveBeenCalledWith({applicationId:entry.id,snapshotId:entry.snapshotId,ledgerRevision:revision});
  expect(clone).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(rawRead).not.toHaveBeenCalled();
 });
 it('closes stale modal and gates actions during dirty or loading ledger, allows explicit refresh',async()=>{
  render(<JobCareerPane {...props()}/>);fireEvent.click(reviewButton());
  act(()=>publish({data:{...session.state.data,revision:'b'.repeat(64)}}));expect(screen.queryByRole('dialog',{name:'永久投递快照只读复盘'})).toBeNull();
  act(()=>publish({dirty:true}));expect(reviewButton()).toBeDisabled();expect(cloneButton()).toBeDisabled();
  act(()=>publish({dirty:false,saving:true}));expect(reviewButton()).toBeDisabled();
  act(()=>publish({saving:false}));fireEvent.click(screen.getByRole('button',{name:'刷新磁盘台账'}));await waitFor(()=>expect(session.load).toHaveBeenLastCalledWith(true));
 });
 it('redaction closes the modal and gates raw review, clone and associated PDF',()=>{
  const p=props(),v=render(<JobCareerPane {...p}/>);fireEvent.click(reviewButton());
  v.rerender(<JobCareerPane {...p} comparisonDisabled/>);
  expect(screen.queryByRole('dialog',{name:'永久投递快照只读复盘'})).toBeNull();expect(reviewButton()).toBeDisabled();expect(cloneButton()).toBeDisabled();expect(screen.getByRole('button',{name:'关联 PDF'})).toBeDisabled();
  expect(openPath).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });
 it('checks the linked archive before cloning and rejects a mismatched returned record',async()=>{
  const rec=sourceRecord();read.mockResolvedValueOnce({...rec,meta:{...rec.meta,applicationId:'wrong'}});
  render(<JobCareerPane {...props()}/>);fireEvent.click(cloneButton());
  await screen.findByText(/永久快照关联身份校验失败，未克隆/);expect(clone).not.toHaveBeenCalled();
  expect(rawRead).not.toHaveBeenCalled();
 });
 it('refuses to clone when ledger becomes dirty during read',async()=>{
  let finish!:(v:ApplicationSnapshotRecord)=>void;read.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
  render(<JobCareerPane {...props()}/>);fireEvent.click(cloneButton());
  act(()=>publish({dirty:true}));await act(async()=>finish(sourceRecord()));
  await screen.findByText(/当前版本或台账状态已变化，未克隆/);expect(clone).not.toHaveBeenCalled();
 });
 it('offers explicit read cancellation and ignores the late IPC reply',async()=>{
  let finish!:(v:ApplicationSnapshotRecord)=>void;read.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
  render(<JobCareerPane {...props()}/>);fireEvent.click(cloneButton());fireEvent.click(screen.getByRole('button',{name:'取消读取快照'}));
  await screen.findByText(/已取消读取永久快照/);await act(async()=>finish(sourceRecord()));
  expect(clone).not.toHaveBeenCalled();expect(cloneButton()).not.toBeDisabled();
 });
 it('cancels clone read when leaving tracker and suppresses late result after return',async()=>{
  let finish!:(v:ApplicationSnapshotRecord)=>void;read.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
  render(<JobCareerPane {...props()}/>);fireEvent.click(cloneButton());fireEvent.click(screen.getByRole('button',{name:'自荐信 / 话术'}));
  await screen.findByText(/已取消读取永久快照/);fireEvent.click(screen.getByRole('button',{name:/投递追踪/}));
  await act(async()=>finish(sourceRecord()));expect(clone).not.toHaveBeenCalled();expect(cloneButton()).not.toBeDisabled();
 });
 it('stops waiting at ten seconds without treating a late reply as a clone',async()=>{
  vi.useFakeTimers();let finish!:(v:ApplicationSnapshotRecord)=>void;read.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
  render(<JobCareerPane {...props()}/>);fireEvent.click(cloneButton());
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_001)});
  expect(screen.getByText(/读取永久快照超过 10 秒/)).toBeTruthy();
  await act(async()=>finish(sourceRecord()));expect(clone).not.toHaveBeenCalled();
 });
 it('separates read cancellation from an explicitly begun normal version creation',async()=>{
  let finish!:()=>void;clone.mockImplementationOnce(()=>new Promise<void>(r=>{finish=r}));
  render(<JobCareerPane {...props()}/>);fireEvent.click(cloneButton());
  await screen.findByRole('button',{name:'创建复盘版…'});
  expect(screen.queryByRole('button',{name:'取消读取快照'})).toBeNull();
  expect(clone).toHaveBeenCalledWith(sourceRecord().document,'合成学校-物理教师-复盘版');
  await act(async()=>finish());await waitFor(()=>expect(cloneButton()).not.toBeDisabled());
 });
});
