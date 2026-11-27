import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { VersionCompareModal } from './VersionCompareModal';
import { comparisonFixture,changedComparisonFixture } from '../../lib/comparisonSyntheticFixture';
import type { ResumeDocument,ResumeSummary } from '../../schema/resumeSchema';
import type { ResumeSnapshotMeta } from '../../server/localFsApi';
import type { ResumeDesktopBridge } from '../../types/electron';
const get=vi.fn(),getForComparison=vi.fn(),save=vi.fn(),restore=vi.fn(),create=vi.fn();
const summary=(slug:string,doc:ResumeDocument):ResumeSummary=>({slug,id:doc.id,title:doc.title,templateId:doc.templateId,updatedAt:doc.updatedAt,isMaster:slug==='master'});
const snapshot:ResumeSnapshotMeta={id:'snap-1',slug:'current',createdAt:'2026-01-01T00:00:00Z',reason:'合成历史',templateId:'minimal-ats',title:'历史标题',charCount:123};
function props(){
  const activeDoc=comparisonFixture(),other=changedComparisonFixture();
  return {activeSlug:'current',activeDoc,summaries:[summary('current',activeDoc),summary('other',other)],masterSummary:null,snapshots:[snapshot],onClose:vi.fn()};
}
beforeEach(()=>{
  vi.resetAllMocks();window.resumeDesktop={resumes:{get,save},snapshots:{getForComparison,restore,create}} as unknown as ResumeDesktopBridge;
  get.mockImplementation(async(slug:string)=>slug==='other'?changedComparisonFixture():comparisonFixture());
  getForComparison.mockResolvedValue({meta:snapshot,document:{...comparisonFixture(),title:'历史标题'}});
  Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();delete window.resumeDesktop;Reflect.deleteProperty(HTMLElement.prototype,'scrollTo');vi.useRealTimers();});
const start=()=>fireEvent.click(screen.getByRole('button',{name:'读取并对比'}));
const select=(value:string)=>fireEvent.change(screen.getByLabelText('对照来源'),{target:{value}});
describe('version comparison read-only modal',()=>{
  it('does not read until requested and never invokes any mutation; masks hidden raw values and assets by default',async()=>{
    render(<VersionCompareModal {...props()}/>);expect(get).not.toHaveBeenCalled();
    select('disk:other');start();await screen.findByText('target@example.invalid');
    const dialog=screen.getByRole('dialog');expect(dialog.textContent).not.toMatch(/HIDDEN_PHONE_|HIDDEN_CUSTOM_|HIDDEN_EVAL_|HIDDEN_BODY_|HIDDEN_SECTION_LABEL_|SYNTHETIC_PHOTO_/);
    expect(screen.getByText('baseline@example.invalid')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('显示隐藏原值（含个人信息）'));
    expect(dialog.textContent).toContain('HIDDEN_PHONE_B');expect(dialog.textContent).not.toContain('SYNTHETIC_PHOTO_');
    fireEvent.click(screen.getByLabelText('显示隐藏原值（含个人信息）'));expect(dialog.textContent).not.toContain('HIDDEN_PHONE_B');
    expect(save).not.toHaveBeenCalled();expect(restore).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
  });
  it('freezes current memory source at click and labels subsequent edits as outside the captured result',async()=>{
    const p=props();let resolve!:(doc:ResumeDocument)=>void;get.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const view=render(<VersionCompareModal {...p}/>);select('disk:other');start();
    view.rerender(<VersionCompareModal {...p} activeDoc={{...p.activeDoc,basic:{...p.activeDoc.basic,email:'later@example.invalid'}}}/>);
    await act(async()=>resolve(changedComparisonFixture()));
    expect(await screen.findByText('baseline@example.invalid')).toBeTruthy();expect(screen.queryByText('later@example.invalid')).toBeNull();
    expect(screen.getByText(/结果固定为本次读取/)).toBeTruthy();
  });
  it('ignores a late read after source selection changes and starts a new request',async()=>{
    let resolve!:(doc:ResumeDocument)=>void;get.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    render(<VersionCompareModal {...props()}/>);select('disk:other');start();
    select('snapshot:snap-1');start();await screen.findByText('右 · 冻结对照（历史快照）');
    await act(async()=>resolve(changedComparisonFixture()));
    expect(screen.queryByText('target@example.invalid')).toBeNull();expect(getForComparison).toHaveBeenCalledWith('current','snap-1');
    expect(screen.getByText(/快照创建时间/)).toBeTruthy();
  });
  it('blocks stale identities and does not reuse a successful result after a failed refresh',async()=>{
    render(<VersionCompareModal {...props()}/>);select('disk:other');start();await screen.findByText('target@example.invalid');
    get.mockResolvedValueOnce({...changedComparisonFixture(),id:'foreign'});
    start();expect((await screen.findByRole('alert')).textContent).toContain('身份已变化');expect(screen.queryByText('target@example.invalid')).toBeNull();
    getForComparison.mockResolvedValueOnce({meta:snapshot,document:{...comparisonFixture(),id:'foreign'}});
    select('snapshot:snap-1');start();expect((await screen.findByRole('alert')).textContent).toContain('身份已变化');
  });
  it('cancels in-flight reads and resets hidden opt-in upon reread',async()=>{
    render(<VersionCompareModal {...props()}/>);select('disk:other');start();await screen.findByText('target@example.invalid');
    fireEvent.click(screen.getByLabelText('显示隐藏原值（含个人信息）'));expect(screen.getByRole('dialog').textContent).toContain('HIDDEN_PHONE_B');
    let resolve!:(doc:ResumeDocument)=>void;get.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    start();fireEvent.click(screen.getByRole('button',{name:'取消读取'}));expect((await screen.findByRole('alert')).textContent).toContain('已取消');
    await act(async()=>resolve(changedComparisonFixture()));expect(screen.queryByText('target@example.invalid')).toBeNull();
    start();await screen.findByText('target@example.invalid');expect(screen.getByRole('dialog').textContent).not.toContain('HIDDEN_PHONE_B');
  });
  it('shows a bounded timeout and ignores a response arriving afterward',async()=>{
    vi.useFakeTimers();let resolve!:(doc:ResumeDocument)=>void;get.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    render(<VersionCompareModal {...props()}/>);select('disk:other');start();
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
    expect(screen.getByRole('alert').textContent).toContain('10 秒');
    await act(async()=>resolve(changedComparisonFixture()));expect(screen.queryByText('target@example.invalid')).toBeNull();
    expect(screen.getByRole('button',{name:'读取并对比'})).not.toBeDisabled();
  });
  it('supports category filters, exact count and unchanged content without falsely reporting updates',async()=>{
    render(<VersionCompareModal {...props()}/>);start();await screen.findByText('所比较的存储内容、结构和样式字段没有差异。');
    select('disk:other');start();await screen.findByText('target@example.invalid');
    fireEvent.click(screen.getByRole('button',{name:'样式'}));
    expect(screen.queryByText('target@example.invalid')).toBeNull();expect(screen.getByText('minimal-ats')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('差异类型'),{target:{value:'added'}});
    expect(screen.getByText('当前筛选无差异。')).toBeTruthy();
    await waitFor(()=>expect(save).not.toHaveBeenCalled());
  });
});
