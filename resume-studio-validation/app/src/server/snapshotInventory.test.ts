// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {LocalResumeStore,createLocalFsMiddleware} from './localFsApi';
import {ResumeDocumentSchema} from '../schema/resumeSchema';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
describe('snapshot inventory remains additive and preserves anomalies',()=>{
  it('reports invalid records separately and keeps the existing HTTP list shape',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-snapshot-inventory-'));roots.push(root);
    const store=new LocalResumeStore(path.join(root,'data'));
    const doc=await store.saveResume('synthetic',ResumeDocumentSchema.parse({id:'synthetic-inventory',title:'Demo',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',basic:{name:'Demo',title:'Role'},menuSections:[{id:'basic',title:'Basic',order:0}],globalSettings:{}}));
    expect(await store.listSnapshotInventory('synthetic')).toEqual({items:[],unreadableCount:0});
    const good=await store.createSnapshot('synthetic','regular');
    const dir=path.join(store.backupsDir,'synthetic');
    await fs.writeFile(path.join(dir,'bad.json'),'{broken');
    await fs.writeFile(path.join(dir,'alias.json'),JSON.stringify({meta:{id:good.id,slug:'synthetic',createdAt:'2020-01-01T00:00:00Z'},document:doc}));
    await fs.mkdir(path.join(dir,'directory.json'));await fs.writeFile(path.join(dir,'note.txt'),'unrelated');
    const inventory=await store.listSnapshotInventory('synthetic');
    expect(inventory.items.map(x=>x.id)).toEqual([good.id]);expect(inventory.unreadableCount).toBe(3);
    expect(await store.listSnapshots('synthetic')).toEqual(inventory.items);
    const middleware=createLocalFsMiddleware(store);
    const server=http.createServer((req,res)=>void middleware(req,res,()=>{res.statusCode=404;res.end();}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const addr=server.address();if(!addr||typeof addr==='string')throw Error('no port');
      const base='http://127.0.0.1:'+addr.port+'/api/resumes/synthetic/';
      const old=await fetch(base+'snapshots');expect(old.status).toBe(200);expect(await old.json()).toEqual(inventory.items);
      const fresh=await fetch(base+'snapshot-inventory');expect(fresh.status).toBe(200);expect(await fresh.json()).toEqual(inventory);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
    expect(await fs.readFile(path.join(dir,'bad.json'),'utf8')).toBe('{broken');
    expect((await fs.stat(path.join(dir,'directory.json'))).isDirectory()).toBe(true);
  });
});
