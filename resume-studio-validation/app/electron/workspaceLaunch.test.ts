// @vitest-environment node
import path from 'node:path';
import os from 'node:os';
import {promises as fs} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {buildWorkspaceLaunch,checkLaunchReceipt,readLaunchHandoff,outerLaunchTemp,recordLaunchStage,lastLaunchStage,shouldBootstrapWorkspace} from './workspaceLaunch';
const dir=path.resolve('temp','resume-studio-launch-test');
const root=path.resolve('copies','resume-studio-restored-v1-test');
const handoff={dir,token:'2e18a861-5562-48ec-8191-d0bf92b6d0e3',basis:'a'.repeat(64)};
const exePath=path.resolve('program','electron.exe'),appDir=path.resolve('program');
describe('isolated workspace process launch',()=>{
  it('uses only fixed app entry and strips unsafe inherited runtime overrides',()=>{
    const plan=buildWorkspaceLaunch({isPackaged:false,exePath,appDir,root,handoff,env:{ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require=wrong',VITE_DEV_SERVER_URL:'http://127.0.0.1:1',NODE_CHANNEL_FD:'5',NODE_PATH:'wrong',ELECTRON_NO_ASAR:'1',RESUME_STUDIO_DATA_DIR:'wrong',PATH:'kept'}});
    expect(plan.executable).toBe(exePath);expect(plan.args).toEqual([appDir]);
    expect(plan.env.RESUME_STUDIO_DATA_DIR).toBe(root);
    expect(plan.env.PATH).toBe('kept');expect(plan.env.ELECTRON_RUN_AS_NODE).toBeUndefined();expect(plan.env.NODE_OPTIONS).toBeUndefined();expect(plan.env.VITE_DEV_SERVER_URL).toBeUndefined();expect(plan.env.NODE_PATH).toBeUndefined();expect(plan.env.ELECTRON_NO_ASAR).toBeUndefined();
    const copy={...plan.env};expect(readLaunchHandoff(copy)).toEqual(handoff);
    expect(copy.RESUME_STUDIO_LAUNCH_TOKEN).toBeUndefined();
  });
  it('uses the outer portable executable and its own extraction temp, not the running extracted binary',()=>{
    const wrapper=path.resolve('portable','Resume Studio.exe');
    const plan=buildWorkspaceLaunch({isPackaged:true,exePath,appDir,root,handoff,env:{PORTABLE_EXECUTABLE_FILE:wrapper,PORTABLE_EXECUTABLE_DIR:path.dirname(wrapper),TEMP:'existing-temp',TMP:'existing-temp'}});
    expect(plan.executable).toBe(wrapper);expect(plan.args).toEqual([]);expect(plan.env.TEMP).toBe(path.join(dir,'portable-temp'));expect(plan.env.TMP).toBe(plan.env.TEMP);
    expect(plan.env.PORTABLE_EXECUTABLE_FILE).toBeUndefined();
    expect(outerLaunchTemp(path.join(dir,'portable-temp'))).toBe(path.dirname(dir));
    expect(()=>buildWorkspaceLaunch({isPackaged:true,exePath,appDir,root,handoff,env:{PORTABLE_EXECUTABLE_DIR:path.dirname(wrapper)}})).toThrow();
  });
  it('reports only bounded, recognized startup stages',async()=>{
    const folder=await fs.mkdtemp(path.join(os.tmpdir(),'resume-studio-launch-test-'));
    try{const h={...handoff,dir:folder};expect(await lastLaunchStage(folder)).toContain('尚未');recordLaunchStage(h,'module-loaded');recordLaunchStage(h,'entry-main');await fs.appendFile(path.join(folder,'progress.txt'),'unrecognized secret\n');expect(await lastLaunchStage(folder)).toBe('entry-main');}finally{await fs.rm(folder,{recursive:true,force:true});}
  });
  it('boots the exact app entry even when Electron imports CJS through ESM, but not a test harness',()=>{
    const context={commonJsMain:false,hasHandoff:false,isPackaged:false,appDir};
    expect(shouldBootstrapWorkspace({...context,argvEntry:appDir})).toBe(true);
    expect(shouldBootstrapWorkspace({...context,argvEntry:path.join(appDir,'dist-electron','main.cjs')})).toBe(true);
    expect(shouldBootstrapWorkspace({...context,argvEntry:path.join(appDir,'validation-smoke.cjs')})).toBe(false);
    expect(shouldBootstrapWorkspace({...context,hasHandoff:true})).toBe(true);
  });
  it('requires a matching one-time receipt and complete launch handoff',()=>{
    const receipt={token:handoff.token,folder:root,pid:100,status:'ready'};
    expect(checkLaunchReceipt(receipt,handoff.token,root)).toEqual(receipt);
    expect(()=>checkLaunchReceipt({...receipt,folder:path.dirname(root)},handoff.token,root)).toThrow();
    expect(()=>checkLaunchReceipt({...receipt,token:'stale'},handoff.token,root)).toThrow();
    expect(()=>readLaunchHandoff({RESUME_STUDIO_LAUNCH_DIR:dir})).toThrow();
  });
});
