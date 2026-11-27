import {describe,it,expect,vi} from 'vitest';
import {CareerLedgerSession} from './careerLedgerSession';
import {JobApplicationSchema,type ApplicationsStoreData} from '../schema/applicationSchema';
const data=(revision='r0'):ApplicationsStoreData=>({schemaVersion:1,revision,applications:[JobApplicationSchema.parse({id:'demo',company:'虚构单位'})],coverLetters:[],interviewAnswers:{}});
describe('career ledger renderer queue',()=>{
  it('serializes rapid changes and uses each confirmed revision without losing later input',async()=>{
    let resolveFirst!:(value:ApplicationsStoreData)=>void;
    const save=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve;})).mockImplementationOnce(async(next:ApplicationsStoreData)=>({...next,revision:'r2'}));
    const session=new CareerLedgerSession({getApplications:async()=>data(),saveApplications:save,logApplication:vi.fn()});
    await session.load();
    session.update(d=>({...d,interviewAnswers:{q:'first'}}));
    session.update(d=>({...d,interviewAnswers:{...d.interviewAnswers,q:'last',other:'second field'}}));
    expect(save).toHaveBeenCalledTimes(1);
    resolveFirst({...data('r1'),interviewAnswers:{q:'first'}});
    await session.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[1]).toBe('r1');
    expect(session.getSnapshot().data.interviewAnswers).toEqual({q:'last',other:'second field'});
    expect(session.getSnapshot().dirty).toBe(false);
  });
  it('preserves failed draft across automatic refresh and only discards after explicit successful reload',async()=>{
    const read=vi.fn().mockResolvedValueOnce(data()).mockRejectedValueOnce(new Error('read failure')).mockResolvedValueOnce(data('external'));
    const save=vi.fn().mockRejectedValueOnce(new Error('conflict'));
    const session=new CareerLedgerSession({getApplications:read,saveApplications:save,logApplication:vi.fn()});
    await session.load();
    session.update(d=>({...d,interviewAnswers:{q:'unsaved'}}));
    await expect(session.flush()).rejects.toThrow('conflict');
    await session.load();
    expect(read).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().dirty).toBe(true);
    await expect(session.load(true)).rejects.toThrow('read failure');
    expect(session.getSnapshot().data.interviewAnswers.q).toBe('unsaved');
    await session.load(true);
    expect(session.getSnapshot().dirty).toBe(false);
    expect(session.getSnapshot().data.revision).toBe('external');
  });
  it('does not permit editing before a successful load',async()=>{
    const session=new CareerLedgerSession({getApplications:async()=>{throw new Error('corrupt')},saveApplications:vi.fn(),logApplication:vi.fn()});
    await expect(session.load()).rejects.toThrow('corrupt');
    expect(session.update(d=>({...d,interviewAnswers:{q:'draft'}}))).toBe(false);
    expect(session.getSnapshot().ready).toBe(false);
  });
  it('serializes an explicit queue command with clean ledger state, never uses generic save, and requires refresh on uncertainty',async()=>{
    let finish!:(v:ApplicationsStoreData)=>void;
    const commandJobQueue=vi.fn().mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockRejectedValueOnce(Error('合成命令失败'));
    const saveApplications=vi.fn(),session=new CareerLedgerSession({getApplications:async()=>data(),saveApplications,logApplication:vi.fn(),commandJobQueue});
    await session.load();
    const command={taskId:'synthetic',ledgerRevision:'r0',action:'start' as const};
    const running=session.controlQueue(command);
    expect(session.getSnapshot().loading).toBe(true);expect(session.update(d=>d)).toBe(false);
    await expect(session.controlQueue(command)).rejects.toThrow(/状态已变化/);
    finish(data('r1'));await running;
    expect(session.getSnapshot().data.revision).toBe('r1');expect(saveApplications).not.toHaveBeenCalled();
    await expect(session.controlQueue({...command,ledgerRevision:'r1'})).rejects.toThrow('合成命令失败');
    expect(session.getSnapshot().error).toContain('合成命令失败');expect(session.getSnapshot().dirty).toBe(false);
    await session.load();expect(session.getSnapshot().error).toBeNull();
    expect(commandJobQueue).toHaveBeenCalledTimes(2);
  });

  it('poll is nonblocking, ignores a late read after a command or local draft, and does not write',async()=>{
    let reply!:(d:ApplicationsStoreData)=>void;
    const read=vi.fn().mockResolvedValueOnce(data()).mockImplementationOnce(()=>new Promise(r=>{reply=r;})).mockResolvedValueOnce(data('r3'));
    const commandJobQueue=vi.fn().mockResolvedValue(data('r2')),saveApplications=vi.fn();
    const session=new CareerLedgerSession({getApplications:read,saveApplications,logApplication:vi.fn(),commandJobQueue});
    await session.load();
    const poll=session.refreshQueue();await Promise.resolve();
    expect(session.getSnapshot().loading).toBe(false);
    await session.controlQueue({taskId:'synthetic',ledgerRevision:'r0',action:'pause'});
    reply(data('stale-r1'));expect(await poll).toBe('skipped');
    expect(session.getSnapshot().data.revision).toBe('r2');
    expect(await session.refreshQueue()).toBe('refreshed');expect(session.getSnapshot().data.revision).toBe('r3');
    expect(saveApplications).not.toHaveBeenCalled();
  });
  it('bounds the status poll at five seconds, never repeats a hung read, and ignores its late reply',async()=>{
    vi.useFakeTimers();
    try{
      let reply!:(d:ApplicationsStoreData)=>void;
      const read=vi.fn().mockResolvedValueOnce(data()).mockImplementationOnce(()=>new Promise(r=>{reply=r;})).mockResolvedValueOnce(data('new'));
      const session=new CareerLedgerSession({getApplications:read,saveApplications:vi.fn(),logApplication:vi.fn()});
      await session.load();const poll=session.refreshQueue();
      await vi.advanceTimersByTimeAsync(5001);
      expect(await poll).toBe('unavailable');expect(await session.refreshQueue()).toBe('skipped');
      expect(read).toHaveBeenCalledTimes(2);expect(session.getSnapshot().loading).toBe(false);
      reply(data('late'));await Promise.resolve();await Promise.resolve();
      expect(session.getSnapshot().data.revision).toBe('r0');
      expect(await session.refreshQueue()).toBe('refreshed');expect(session.getSnapshot().data.revision).toBe('new');
    }finally{vi.useRealTimers();}
  });
});
