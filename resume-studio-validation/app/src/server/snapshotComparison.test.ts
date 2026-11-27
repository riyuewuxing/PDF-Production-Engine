// @vitest-environment node
import { afterEach,describe,expect,it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { LocalResumeStore,createLocalFsMiddleware } from './localFsApi';
import { comparisonFixture } from '../lib/comparisonSyntheticFixture';
const roots:string[]=[];
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-version-compare-'));roots.push(root);
  const store=new LocalResumeStore(path.join(root,'data'));
  const doc=await store.saveResume('synthetic',comparisonFixture());
  const snapshot=await store.createSnapshot('synthetic','synthetic history');
  const changed=await store.saveResume('synthetic',{...doc,title:'Changed current'});
  const file=store.resolveResumePath('synthetic').filePath,dir=path.join(store.backupsDir,'synthetic'),snapFile=path.join(dir,snapshot.id+'.json');
  return {root,store,doc,changed,snapshot,file,dir,snapFile};
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
describe('read-only historical comparison endpoint',()=>{
  it('returns exact historical document with original metadata and no disk mutation or extra snapshot',async()=>{
    const {store,doc,snapshot,file,dir,snapFile}=await fixture();
    const before=await fs.readFile(file),history=await fs.readFile(snapFile),names=await fs.readdir(dir);
    const rec=await store.getSnapshotForComparison('synthetic',snapshot.id);
    expect(rec.document).toEqual(doc);expect(rec.meta).toEqual(snapshot);
    expect(await fs.readFile(file)).toEqual(before);expect(await fs.readFile(snapFile)).toEqual(history);expect(await fs.readdir(dir)).toEqual(names);
  });
  it('rejects aliases, path traversal, empty IDs, non-string parameters and missing records',async()=>{
    const {store,snapshot,file,dir}=await fixture();const before=await fs.readFile(file),names=await fs.readdir(dir);
    for(const id of [snapshot.id+'.json',' '+snapshot.id,'../escape','missing','',null as unknown as string])await expect(store.getSnapshotForComparison('synthetic',id)).rejects.toBeTruthy();
    for(const slug of ['../synthetic','%73ynthetic',null as unknown as string])await expect(store.getSnapshotForComparison(slug,snapshot.id)).rejects.toBeTruthy();
    expect(await fs.readFile(file)).toEqual(before);expect(await fs.readdir(dir)).toEqual(names);
  });
  it('rejects foreign slug, alias identity and document identity mismatches without exposing contents',async()=>{
    const {store,doc,file,dir,snapshot,snapFile}=await fixture();
    const before=await fs.readFile(file),history=await fs.readFile(snapFile);
    const record={meta:{...snapshot,id:'foreign',slug:'other'},document:{...doc,title:'FOREIGN_PRIVATE'}};
    await fs.writeFile(path.join(dir,'foreign.json'),JSON.stringify(record));
    await fs.writeFile(path.join(dir,'alias.json'),JSON.stringify({...record,meta:{...snapshot,slug:'synthetic'}}));
    await fs.writeFile(path.join(dir,'other-doc.json'),JSON.stringify({...record,meta:{...snapshot,id:'other-doc'},document:{...doc,id:'other-doc',title:'FOREIGN_PRIVATE'}}));
    await expect(store.getSnapshotForComparison('synthetic','foreign')).rejects.toMatchObject({code:'SNAPSHOT_INVALID'});
    await expect(store.getSnapshotForComparison('synthetic','alias')).rejects.toMatchObject({code:'SNAPSHOT_INVALID'});
    await expect(store.getSnapshotForComparison('synthetic','other-doc')).rejects.toMatchObject({code:'DOCUMENT_ID_CONFLICT'});
    expect(await fs.readFile(file)).toEqual(before);expect(await fs.readFile(snapFile)).toEqual(history);
  });
  it('rejects hard-linked history and redirected backup directories',async()=>{
    const {store,root,snapFile,dir,snapshot}=await fixture();
    await fs.link(snapFile,path.join(dir,'linked.json'));
    await expect(store.getSnapshotForComparison('synthetic',snapshot.id)).rejects.toMatchObject({code:'SNAPSHOT_INVALID'});
    await expect(store.getSnapshotForComparison('synthetic','linked')).rejects.toMatchObject({code:'SNAPSHOT_INVALID'});
    await fs.rm(path.join(dir,'linked.json'));const outside=path.join(root,'outside');await fs.mkdir(outside);
    await fs.rename(store.backupsDir,path.join(root,'original-backup'));
    await fs.symlink(outside,store.backupsDir,process.platform==='win32'?'junction':'dir');
    await expect(store.getSnapshotForComparison('synthetic',snapshot.id)).rejects.toMatchObject({code:'SNAPSHOT_UNSAFE'});
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it('does not create directories or restore a deleted version when no current record exists',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-no-compare-'));roots.push(root);const store=new LocalResumeStore(path.join(root,'data'));
    await expect(store.getSnapshotForComparison('synthetic','absent')).rejects.toMatchObject({code:'SNAPSHOT_NOT_FOUND'});
    expect(await fs.readdir(root)).toEqual([]);
    const {store:existing,file,snapshot,snapFile}=await fixture();const bytes=await fs.readFile(snapFile);
    await fs.rm(file);await expect(existing.getSnapshotForComparison('synthetic',snapshot.id)).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(fs.stat(file)).rejects.toMatchObject({code:'ENOENT'});expect(await fs.readFile(snapFile)).toEqual(bytes);
  });
  it('provides a GET-only local HTTP endpoint and rejects ambiguous or encoded alias routes',async()=>{
    const {store,doc,snapshot,file,dir}=await fixture();const before=await fs.readFile(file),names=await fs.readdir(dir);
    const middleware=createLocalFsMiddleware(store),server=http.createServer((req,res)=>void middleware(req,res,()=>{res.statusCode=404;res.end();}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const addr=server.address();if(!addr||typeof addr==='string')throw Error('port missing');
      const base='http://127.0.0.1:'+addr.port+'/api/resumes/synthetic/snapshot-preview/';
      const good=await fetch(base+snapshot.id);expect(good.status).toBe(200);expect(good.headers.get('cache-control')).toBe('no-store');expect(good.headers.get('cross-origin-resource-policy')).toBe('same-origin');expect((await good.json()).document).toEqual(doc);
      for(const url of [base+snapshot.id+'.json',base+'%2e%2e%2fsecret',base+'missing'])expect((await fetch(url)).ok).toBe(false);
      const post=await fetch(base+snapshot.id,{method:'POST'});expect(post.status).toBe(405);expect(post.headers.get('allow')).toBe('GET');
      const deniedHeaders:Record<string,string>[]=[{Origin:'https://example.invalid'},{'Sec-Fetch-Site':'cross-site'},{Origin:'null'},{Origin:'https://127.0.0.1:'+addr.port},{Origin:'http://127.0.0.1:'+addr.port+'/foreign'}];
      for(const headers of deniedHeaders){
        const remote=await fetch(base+snapshot.id,{headers});expect(remote.status).toBe(403);expect(remote.headers.get('cache-control')).toBe('no-store');expect(await remote.text()).not.toContain(doc.basic.email);
      }
      const foreignHost=await new Promise<number>((resolve,reject)=>{const request=http.get(base+snapshot.id,{headers:{Host:'example.invalid'}},res=>{res.resume();resolve(res.statusCode??0);});request.on('error',reject);});
      expect(foreignHost).toBe(403);
      const localOrigin=await fetch(base+snapshot.id,{headers:{Origin:'http://127.0.0.1:'+addr.port,'Sec-Fetch-Site':'same-origin'}});
      expect(localOrigin.status).toBe(200);
      expect(await fs.readFile(file)).toEqual(before);expect(await fs.readdir(dir)).toEqual(names);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
