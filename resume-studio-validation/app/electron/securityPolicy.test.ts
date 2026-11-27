// @vitest-environment node
import { describe,expect,it } from 'vitest';
import path from 'node:path';
import { rendererEntryUrl,isTrustedRendererFrame,isSafeExportFileName,isPathInside,isLoopbackDevEntry } from './securityPolicy';
describe('Electron trust boundaries',()=>{
  const expected=rendererEntryUrl({type:'file',target:path.resolve('dist/index.html')});
  const valid={senderId:1,expectedSenderId:1,isMainFrame:true,url:expected,expectedUrl:expected};
  it('requires exact trusted top-level document and sender',()=>{
    expect(isTrustedRendererFrame(valid)).toBe(true);
    for(const input of [{senderId:2},{isMainFrame:false},{url:'https://example.invalid/'},{url:expected+'?mode=print'},{url:expected+'#other'},{url:'invalid'}]) expect(isTrustedRendererFrame({...valid,...input})).toBe(false);
  });
  it('accepts only the unreserved tilde spelling of a local portable file pathname',()=>{
    const literal='file:///C:/Users/RUNNER~1/AppData/Local/Temp/nsrEF44.tmp/app/resources/app.asar/dist/index.html';
    const encoded=literal.replace('~','%7E'),lower=literal.replace('~','%7e');
    for(const [url,expectedUrl] of [[literal,encoded],[encoded,literal],[lower,encoded]] as const){
      expect(isTrustedRendererFrame({...valid,url,expectedUrl})).toBe(true);
    }
    for(const url of [literal.replace('~','%257E'),literal.replace('RUNNER~1','RUNNER~2'),literal.replace('~','%2F'),literal.replace('~','%5C'),literal.replace('index.html','other.html'),literal+'?mode=print',literal+'#x',literal.replace('C:/','D:/'),literal.replace('file:///','file://server/'),literal.replace('file:///','https://')]){
      expect(isTrustedRendererFrame({...valid,url,expectedUrl:encoded})).toBe(false);
    }
    expect(isTrustedRendererFrame({...valid,senderId:2,url:literal,expectedUrl:encoded})).toBe(false);
    expect(isTrustedRendererFrame({...valid,isMainFrame:false,url:literal,expectedUrl:encoded})).toBe(false);
    const a=literal+'?mode=print&jobId=A',b=encoded+'?mode=print&jobId=A';
    expect(isTrustedRendererFrame({...valid,url:a,expectedUrl:b})).toBe(true);
    expect(isTrustedRendererFrame({...valid,url:a.replace('jobId=A','jobId=B'),expectedUrl:b})).toBe(false);
    expect(isTrustedRendererFrame({...valid,url:literal+'?jobId=~',expectedUrl:encoded+'?jobId=%7E'})).toBe(false);
    expect(isTrustedRendererFrame({...valid,url:literal+'#~',expectedUrl:encoded+'#%7E'})).toBe(false);
    expect(isTrustedRendererFrame({...valid,url:'https://localhost/~',expectedUrl:'https://localhost/%7E'})).toBe(false);
    expect(isTrustedRendererFrame({...valid,url:'file://server/share/~',expectedUrl:'file://server/share/%7E'})).toBe(false);
  });
  it('binds print entry to its unique job query',()=>{
    const target=path.resolve('dist/index.html');
    const first=rendererEntryUrl({type:'file',target,search:{mode:'print',jobId:'A'}});
    const other=rendererEntryUrl({type:'file',target,search:{mode:'print',jobId:'B'}});
    expect(isTrustedRendererFrame({...valid,url:first,expectedUrl:first})).toBe(true);
    expect(isTrustedRendererFrame({...valid,url:other,expectedUrl:first})).toBe(false);
  });
  it('only accepts local dev entry without credentials or alternate origin',()=>{
    for(const url of ['http://127.0.0.1:5173/','http://localhost:5173/','http://[::1]:5173/'])expect(isLoopbackDevEntry(url)).toBe(true);
    for(const url of ['https://example.invalid/','http://127.0.0.1.example.invalid/','http://user@localhost/','file:///index.html','http://localhost/?mode=print'])expect(isLoopbackDevEntry(url)).toBe(false);
  });
  it('restricts shell file types and contained paths',()=>{
    const root=path.resolve('exports');
    expect(isSafeExportFileName(path.join(root,'sample.pdf'))).toBe(true);
    for(const name of ['sample.exe','sample.lnk','sample.bat','sample.url','sample.ps1','sample.cmd','sample.pdf.exe'])expect(isSafeExportFileName(path.join(root,name))).toBe(false);
    expect(isSafeExportFileName('relative.pdf')).toBe(false);
    expect(isPathInside(root,path.join(root,'sample.pdf'))).toBe(true);
    expect(isPathInside(root,path.resolve('exports-other/sample.pdf'))).toBe(false);
    expect(isPathInside(root,root)).toBe(false);
  });
});
