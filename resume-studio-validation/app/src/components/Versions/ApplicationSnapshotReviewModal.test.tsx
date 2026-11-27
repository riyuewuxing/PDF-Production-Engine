import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {VersionCompareModal,type ApplicationReviewSource} from './VersionCompareModal';
import {comparisonFixture,changedComparisonFixture} from '../../lib/comparisonSyntheticFixture';
import type {ResumeDocument,ResumeSummary} from '../../schema/resumeSchema';
import type {ApplicationSnapshotRecord} from '../../schema/applicationSchema';
import type {ResumeDesktopBridge} from '../../types/electron';
const get=vi.fn(),getLinkedSnapshot=vi.fn(),getSnapshot=vi.fn(),save=vi.fn(),restore=vi.fn(),log=vi.fn();
const summary=(slug:string,doc:ResumeDocument):ResumeSummary=>({slug,id:doc.id,title:doc.title,templateId:doc.templateId,updatedAt:doc.updatedAt,isMaster:slug==='master'});
const source:ApplicationReviewSource={id:'synthetic-application',snapshotId:'app-synthetic-39',resumeSlug:'archived-origin',company:'合成学校',role:'物理教师',exportedFilePath:'C:/synthetic/old.pdf',atsScore:67,ledgerRevision:'a'.repeat(64)};
function record():ApplicationSnapshotRecord{
 const doc=comparisonFixture();
 return {meta:{id:source.snapshotId,applicationId:source.id,resumeSlug:source.resumeSlug,exportedFilePath:source.exportedFilePath,atsScore:source.atsScore,createdAt:'2026-01-01T00:00:00Z',title:doc.title,templateId:doc.templateId},document:doc};
}
function props(){
 const activeDoc=changedComparisonFixture(),disk={...activeDoc,basic:{...activeDoc.basic,email:'disk-only@example.invalid'}};
 return {activeSlug:'current',activeDoc,summaries:[summary('current',activeDoc),summary('disk-only',disk)],masterSummary:null,snapshots:[],applicationReview:source,onClose:vi.fn()};
}
beforeEach(()=>{
 vi.resetAllMocks();window.resumeDesktop={resumes:{get,save},applications:{getLinkedSnapshot,getSnapshot,log},snapshots:{restore}} as unknown as ResumeDesktopBridge;
 getLinkedSnapshot.mockImplementation(async()=>record());get.mockImplementation(async()=>({...changedComparisonFixture(),basic:{...changedComparisonFixture().basic,email:'disk-only@example.invalid'}}));
 Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();delete window.resumeDesktop;Reflect.deleteProperty(HTMLElement.prototype,'scrollTo');vi.useRealTimers();});
const read=()=>fireEvent.click(screen.getByRole('button',{name:'读取并对比'}));
const select=(value:string)=>fireEvent.change(screen.getByLabelText('对照来源'),{target:{value}});
describe('permanent application snapshot comparison modal',()=>{
 it('uses sealed original as left baseline and current memory as right without fetching or saving the editable resume',async()=>{
  render(<VersionCompareModal {...props()}/>);expect(getLinkedSnapshot).not.toHaveBeenCalled();
  expect(screen.getByText(/关联版本不在当前可用列表/)).toBeTruthy();expect(screen.getByText(/对照稿不是台账原关联版本/)).toBeTruthy();
  read();await screen.findByText('左 · 冻结基准（永久投递原稿）');
  const dialog=screen.getByRole('dialog',{name:'永久投递快照只读复盘'});
  expect(dialog.textContent).toContain('封存时间');expect(dialog.textContent).toContain('右 · 冻结对照（内存稿）');
  expect(dialog.textContent).toContain('PDF 路径，但本次不读取或核验 PDF 字节');
  expect(dialog.querySelector('[data-compare-side="before"]')?.textContent).toContain('基准合成版本');
  expect(dialog.textContent).toContain('baseline@example.invalid');expect(dialog.textContent).toContain('target@example.invalid');
  expect(dialog.textContent).not.toContain('HIDDEN_PHONE_A');expect(dialog.textContent).not.toContain('HIDDEN_PHONE_B');
  expect(getLinkedSnapshot).toHaveBeenCalledWith({applicationId:source.id,snapshotId:source.snapshotId,ledgerRevision:source.ledgerRevision});
  for(const fn of [get,getSnapshot,save,restore,log])expect(fn).not.toHaveBeenCalled();
 });
 it('reads a selected disk version separately, preserves hidden defaults and styles',async()=>{
  render(<VersionCompareModal {...props()}/>);select('disk:disk-only');read();await screen.findByText('disk-only@example.invalid');
  expect(screen.getByText('右 · 冻结对照（磁盘版本）')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('显示隐藏原值（含个人信息）'));expect(screen.getByRole('dialog').textContent).toContain('HIDDEN_PHONE_A');
  fireEvent.click(screen.getByRole('button',{name:'样式'}));expect(screen.getByText('minimal-ats')).toBeTruthy();expect(screen.queryByText('disk-only@example.invalid')).toBeNull();
  expect(get).toHaveBeenCalledWith('disk-only');expect(save).not.toHaveBeenCalled();
 });
 it('does not expose raw archive content for any mismatched metadata and never falls back to unbound reader',async()=>{
  render(<VersionCompareModal {...props()}/>);
  for(const patch of [{applicationId:'foreign'},{resumeSlug:'foreign'},{id:'foreign'},{exportedFilePath:'foreign'},{atsScore:0},{title:'foreign'},{createdAt:'invalid'}]){
   const rec=record();getLinkedSnapshot.mockResolvedValueOnce({...rec,meta:{...rec.meta,...patch},document:{...rec.document,basic:{...rec.document.basic,email:'foreign-private@example.invalid'}}});
   read();expect((await screen.findByRole('alert')).textContent).toContain('关联身份校验失败');expect(screen.queryByText('foreign-private@example.invalid')).toBeNull();
  }
  expect(getSnapshot).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
 });
 it('clears result on failed reread and refuses obsolete desktop bridges',async()=>{
  render(<VersionCompareModal {...props()}/>);read();await screen.findByText('baseline@example.invalid');
  getLinkedSnapshot.mockRejectedValueOnce(new Error('磁盘投递台账已变化，请重新读取台账后复盘。'));
  read();expect((await screen.findByRole('alert')).textContent).toContain('台账已变化');expect(screen.queryByText('baseline@example.invalid')).toBeNull();
  Reflect.deleteProperty(window.resumeDesktop!.applications,'getLinkedSnapshot');
  read();expect((await screen.findByRole('alert')).textContent).toContain('当前桌面桥接不支持');expect(getSnapshot).not.toHaveBeenCalled();
 });
 it('freezes the current memory at explicit read, even while the archive is loading',async()=>{
  let finish!:(v:ApplicationSnapshotRecord)=>void;getLinkedSnapshot.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
  const p=props(),view=render(<VersionCompareModal {...p}/>);read();
  view.rerender(<VersionCompareModal {...p} activeDoc={{...p.activeDoc,basic:{...p.activeDoc.basic,email:'later@example.invalid'}}}/>);
  await act(async()=>finish(record()));expect(await screen.findByText('target@example.invalid')).toBeTruthy();expect(screen.queryByText('later@example.invalid')).toBeNull();
 });
 it('cancels an in-flight archive request on target switch and ignores stale result',async()=>{
  let finish!:(v:ApplicationSnapshotRecord)=>void;getLinkedSnapshot.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
  render(<VersionCompareModal {...props()}/>);read();select('disk:disk-only');read();await screen.findByText('disk-only@example.invalid');
  await act(async()=>finish(record()));expect(screen.queryByText('target@example.invalid')).toBeNull();expect(getLinkedSnapshot).toHaveBeenCalledTimes(2);
 });
 it('times out archive read, prevents delayed target read, and closes without any mutation',async()=>{
  vi.useFakeTimers();let finish!:(v:ApplicationSnapshotRecord)=>void;getLinkedSnapshot.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
  const p=props();render(<VersionCompareModal {...p}/>);select('disk:disk-only');read();
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});expect(screen.getByRole('alert').textContent).toContain('10 秒');
  await act(async()=>finish(record()));expect(get).not.toHaveBeenCalled();expect(screen.queryByText('baseline@example.invalid')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'关闭对照'}));expect(p.onClose).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();expect(restore).not.toHaveBeenCalled();
 });
});
