import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {JobQueuePane} from './JobQueuePane';
import {comparisonFixture} from '../../lib/comparisonSyntheticFixture';
import {prepareJobQueueTask} from '../../lib/jobQueueBinding';
import type {ApplicationsStoreData} from '../../schema/applicationSchema';
import type {ResumeDocument} from '../../schema/resumeSchema';
import type {ResumeDesktopBridge} from '../../types/electron';
type State={data:ApplicationsStoreData;ready:boolean;loading:boolean;saving:boolean;dirty:boolean;error:string|null;recoveryError:string|null};
const session=vi.hoisted(()=>({state:null as unknown as State,listeners:new Set<()=>void>(),load:vi.fn(),update:vi.fn(),flush:vi.fn()}));
vi.mock('../../lib/careerLedgerSession',()=>({careerLedger:{getSnapshot:()=>session.state,subscribe:(listener:()=>void)=>{session.listeners.add(listener);return ()=>session.listeners.delete(listener);},load:session.load,update:session.update,flush:session.flush}}));
const read=vi.fn(),save=vi.fn(),log=vi.fn(),ai=vi.fn();
const revision='a'.repeat(64);
const props=()=>({activeSlug:'current',activeDoc:comparisonFixture(),redacted:false});
function publish(patch:Partial<State>){session.state={...session.state,...patch};for(const listener of session.listeners)listener();}
const prepare=()=>fireEvent.click(screen.getByRole('button',{name:'核对任务绑定'}));
const confirm=()=>screen.queryByRole('button',{name:'确认登记岗位任务'});
const jd='  合成岗位原文\n保留输入。  ';
function fill(){
  fireEvent.change(screen.getByRole('textbox',{name:'队列单位'}),{target:{value:'合成单位'}});
  fireEvent.change(screen.getByRole('textbox',{name:'队列岗位'}),{target:{value:'物理教师'}});
  fireEvent.change(screen.getByRole('textbox',{name:'队列岗位原文'}),{target:{value:jd}});
}
beforeEach(()=>{
  vi.resetAllMocks();vi.stubGlobal('crypto',webcrypto);session.listeners.clear();
  session.state={data:{schemaVersion:1,revision,applications:[],coverLetters:[],interviewAnswers:{}},ready:true,loading:false,saving:false,dirty:false,error:null,recoveryError:null};
  session.load.mockResolvedValue(undefined);
  session.update.mockImplementation((transform:(d:ApplicationsStoreData)=>ApplicationsStoreData)=>{publish({data:transform(session.state.data),dirty:true});return true;});
  session.flush.mockImplementation(async()=>{publish({data:{...session.state.data,revision:'b'.repeat(64)},dirty:false});});
  read.mockResolvedValue(comparisonFixture());
  window.resumeDesktop={isDesktop:true,resumes:{get:read,save},applications:{log},ai:{request:ai}} as unknown as ResumeDesktopBridge;
});
afterEach(()=>{cleanup();delete window.resumeDesktop;vi.useRealTimers();vi.unstubAllGlobals();});
describe('job queue registration renderer safeguards',()=>{
  it('only reads on explicit request and writes once after separate confirmation; cancel leaves original text intact',async()=>{
    render(<JobQueuePane {...props()}/>);expect(read).not.toHaveBeenCalled();fill();prepare();
    await screen.findByRole('region',{name:'确认岗位任务绑定'});expect(session.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'取消本次登记'}));expect(confirm()).toBeNull();
    expect(screen.getByRole('textbox',{name:'队列岗位原文'})).toHaveValue(jd);expect(session.update).not.toHaveBeenCalled();
    prepare();await screen.findByRole('button',{name:'确认登记岗位任务'});fireEvent.click(confirm()!);
    await waitFor(()=>expect(session.state.dirty).toBe(false));
    expect(session.update).toHaveBeenCalledTimes(1);expect(session.flush).toHaveBeenCalledTimes(1);
    expect(session.state.data.jobQueue?.[0]).toMatchObject({company:'合成单位',role:'物理教师',jdText:jd,slug:'current',status:'pending'});
    expect(save).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();expect(ai).not.toHaveBeenCalled();
  });
  it('cancels an in-flight read and ignores a late reply',async()=>{
    let resolve!:(doc:ResumeDocument)=>void;read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    render(<JobQueuePane {...props()}/>);fill();prepare();fireEvent.click(screen.getByRole('button',{name:'取消读取'}));
    await screen.findByText('已取消读取。');await act(async()=>resolve(comparisonFixture()));
    expect(confirm()).toBeNull();expect(session.update).not.toHaveBeenCalled();
  });
  it('rejects an unsaved memory draft without substituting the stored version',async()=>{
    const p=props();render(<JobQueuePane {...p} activeDoc={{...p.activeDoc,title:'未保存合成稿'}}/>);fill();prepare();
    await screen.findByText(/当前编辑与磁盘版本不同/);expect(confirm()).toBeNull();expect(session.update).not.toHaveBeenCalled();
  });
  it('invalidates prepared binding when same document is edited or ledger revision changes',async()=>{
    const p=props(),view=render(<JobQueuePane {...p}/>);fill();prepare();await screen.findByRole('button',{name:'确认登记岗位任务'});
    view.rerender(<JobQueuePane {...p} activeDoc={{...p.activeDoc,title:'同身份已改'}}/>);expect(confirm()).toBeNull();expect(session.update).not.toHaveBeenCalled();
    view.rerender(<JobQueuePane {...p}/>);prepare();await screen.findByRole('button',{name:'确认登记岗位任务'});
    act(()=>publish({data:{...session.state.data,revision:'c'.repeat(64)}}));expect(confirm()).toBeNull();expect(session.update).not.toHaveBeenCalled();
  });
  it('disables operations for an unacknowledged ledger, and suppresses delayed reads after redaction',async()=>{
    const p=props(),view=render(<JobQueuePane {...p}/>);fill();
    act(()=>publish({dirty:true}));expect(screen.getByRole('button',{name:'核对任务绑定'})).toBeDisabled();
    act(()=>publish({dirty:false}));let resolve!:(doc:ResumeDocument)=>void;read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));prepare();
    view.rerender(<JobQueuePane {...p} redacted/>);expect(screen.queryByRole('textbox',{name:'队列岗位原文'})).toBeNull();
    view.rerender(<JobQueuePane {...p}/>);await act(async()=>resolve(comparisonFixture()));expect(confirm()).toBeNull();expect(session.update).not.toHaveBeenCalled();
  });
  it('enforces a ten-second read deadline, ignores a late reply and never starts a write',async()=>{
    vi.useFakeTimers();let resolve!:(doc:ResumeDocument)=>void;read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    render(<JobQueuePane {...props()}/>);fill();prepare();
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(screen.getByText('读取超过10秒，未继续等待。')).toBeTruthy();await act(async()=>resolve(comparisonFixture()));
    expect(confirm()).toBeNull();expect(session.update).not.toHaveBeenCalled();
  });
  it('checks stale bindings only on request, masks persisted job details in redaction and never mutates task state',async()=>{
    const p=props(),task=await prepareJobQueueTask({id:crypto.randomUUID(),company:'合成单位',role:'物理教师',jdText:jd,slug:p.activeSlug,createdAt:'2026-11-27T00:00:00Z'},p.activeDoc);
    session.state={...session.state,data:{...session.state.data,jobQueue:[task]}};
    const view=render(<JobQueuePane {...p}/>);expect(screen.getByText('未核验当前版本')).toBeTruthy();expect(read).not.toHaveBeenCalled();
    read.mockResolvedValueOnce({...p.activeDoc,title:'同修订不同内容'});
    fireEvent.click(screen.getByRole('button',{name:'核验岗位绑定 合成单位 物理教师'}));await screen.findByText('版本已变化，原任务不得沿用');
    expect(session.update).not.toHaveBeenCalled();expect(session.state.data.jobQueue).toEqual([task]);
    view.rerender(<JobQueuePane {...p} redacted/>);expect(screen.queryByText('合成单位 · 物理教师')).toBeNull();expect(screen.queryByRole('button',{name:'核验岗位绑定 合成单位 物理教师'})).toBeNull();
  });
  it('keeps a failed save visibly unacknowledged, rather than claiming success or starting another task',async()=>{
    session.flush.mockRejectedValueOnce(Error('合成磁盘写入失败'));render(<JobQueuePane {...props()}/>);fill();prepare();await screen.findByRole('button',{name:'确认登记岗位任务'});fireEvent.click(confirm()!);
    await screen.findByText('合成磁盘写入失败');expect(session.state.dirty).toBe(true);expect(screen.getByRole('button',{name:'核对任务绑定'})).toBeDisabled();
    expect(screen.queryByText('岗位任务已保存到本地台账；尚未运行。')).toBeNull();expect(ai).not.toHaveBeenCalled();
  });
});
