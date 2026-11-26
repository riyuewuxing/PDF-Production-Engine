import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {WorkspaceBackupPane} from './WorkspaceBackupPane';
import type {ResumeDesktopBridge} from '../../types/electron';
const row={createdAt:'2026-01-01T00:00:00Z',fileCount:1,totalBytes:1024,counts:{'master.json':1},warnings:[],folder:'C:/synthetic/resume-studio-restored-v1-test'};
const mocks={create:vi.fn(),inspect:vi.fn(),restore:vi.fn(),prepareLaunch:vi.fn(),launch:vi.fn()};
const scroll=vi.fn();
beforeEach(()=>{
  vi.resetAllMocks();
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:scroll});
  window.resumeDesktop={workspaceBackup:mocks} as unknown as ResumeDesktopBridge;
  mocks.inspect.mockResolvedValue({...row,token:'backup-token'});
  mocks.restore.mockResolvedValue(row);
  mocks.prepareLaunch.mockResolvedValue({...row,token:'launch-token'});
  mocks.launch.mockResolvedValue({folder:row.folder,pid:123,ready:true});
});
afterEach(()=>{cleanup();delete window.resumeDesktop;Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');});
async function inspectLaunch(){
  fireEvent.click(screen.getByRole('button',{name:'检查并打开已有恢复工作区'}));
  await screen.findByLabelText('独立工作区打开确认');
  expect(screen.getByRole('button',{name:'确认打开独立工作区'})).toHaveProperty('disabled',true);
  fireEvent.click(screen.getByLabelText('确认打开独立恢复工作区'));
  fireEvent.click(screen.getByRole('button',{name:'确认打开独立工作区'}));
}
describe('workspace backup feedback',()=>{
  it('shows confirmed readiness in the operation feedback region and scrolls it into view',async()=>{
    render(<WorkspaceBackupPane onFlush={async()=>{}}/>);
    await inspectLaunch();
    await screen.findByText(/新窗口就绪/);
    const feedback=screen.getByLabelText('工作区操作反馈');
    expect(feedback.textContent).toContain('123');
    expect(feedback.textContent).toContain(row.folder);
    expect(mocks.launch).toHaveBeenCalledWith('launch-token','OPEN_INDEPENDENT_WORKSPACE');
    expect(scroll).toHaveBeenCalledWith({block:'nearest',inline:'nearest'});
  });
  it('shows refusal, never stale success, and requires renewed inspection',async()=>{
    mocks.launch.mockRejectedValue(new Error('恢复工作区数据已变化，请重新检查。'));
    render(<WorkspaceBackupPane onFlush={async()=>{}}/>);
    await inspectLaunch();
    expect((await screen.findByRole('alert')).textContent).toContain('数据已变化');
    expect(screen.queryByLabelText('独立工作区启动结果')).toBeNull();
    expect(screen.queryByRole('button',{name:'确认打开独立工作区'})).toBeNull();
    expect(scroll).toHaveBeenCalledWith({block:'nearest',inline:'nearest'});
  });
  it('keeps manual startup instructions collapsed by default after recovery',async()=>{
    render(<WorkspaceBackupPane onFlush={async()=>{}}/>);
    fireEvent.click(screen.getByRole('button',{name:'检查已有备份'}));
    await screen.findByLabelText('确认恢复到独立新工作区');
    fireEvent.click(screen.getByLabelText('确认恢复到独立新工作区'));
    fireEvent.click(screen.getByRole('button',{name:'恢复到独立新工作区'}));
    await screen.findByText('手动启动（备用方式）');
    expect(screen.getByText('手动启动（备用方式）').closest('details')?.open).toBe(false);
    expect(screen.getByRole('button',{name:'检查并打开刚恢复的工作区'})).toBeTruthy();
    fireEvent.click(screen.getByText('手动启动（备用方式）'));
    await waitFor(()=>expect(screen.getByText('手动启动（备用方式）').closest('details')?.open).toBe(true));
  });
});
