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
});
