import {promises as fs,type Stats} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withResumeWriteLock} from '../src/server/localFsApi';
import {DEFAULT_BYOK_SETTINGS,resolveAiLimits,resolveDeepSeekThinking,validateByokBaseUrl,type ByokAiSettings,type AiProfileCatalog} from '../src/lib/byokAiClient';

export interface CredentialCodec {available:()=>boolean;encrypt:(text:string)=>Buffer;decrypt:(bytes:Buffer)=>string}
type Meta=Pick<ByokAiSettings,'enabled'|'providerLabel'|'baseUrl'|'model'|'contextBudgetChars'|'maxOutputTokens'|'timeoutMs'|'deepseekThinking'>;
type StoredProfile=Meta&{profileId:string;revision:string;encryptedApiKey?:string};
type Catalog={schemaVersion:2;activeProfileId:string;profiles:StoredProfile[]};
const DEFAULT_ID='default';
// A valid 24-profile catalog (including bounded encrypted keys) fits within this limit.
const MAX_CATALOG_BYTES=2*1024*1024;
const MAX_KEY_CHARS=4096;
const MAX_ENCRYPTED_KEY_CHARS=32768;
type LoadedCatalog={catalog:Catalog;basis:Stats|null};
function sameBasis(a:Stats|null,b:Stats|null):boolean{
  if(!a||!b)return a===b;
  return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.nlink===b.nlink;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asRecord(raw:unknown):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('AI 配置格式不合法。');return raw as Record<string,unknown>;
}
function metadataFrom(raw:Record<string,unknown>):Meta{
  const model=typeof raw.model==='string'&&raw.model.trim()?raw.model.trim():DEFAULT_BYOK_SETTINGS.model;
  const providerLabel=typeof raw.providerLabel==='string'&&raw.providerLabel.trim()?raw.providerLabel.trim():DEFAULT_BYOK_SETTINGS.providerLabel;
  const {baseUrl}=validateByokBaseUrl(typeof raw.baseUrl==='string'?raw.baseUrl:DEFAULT_BYOK_SETTINGS.baseUrl);
  if(model.length>200||providerLabel.length>200||baseUrl.length>2048)throw new Error('AI 配置字段过长。');
  const num=(k:string)=>{const v=raw[k];if(v!==undefined&&typeof v!=='number')throw new Error('AI 请求预算配置不合法。');return v as number|undefined;};
  const limits=resolveAiLimits({enabled:false,providerLabel,baseUrl,model,apiKey:'',contextBudgetChars:num('contextBudgetChars'),maxOutputTokens:num('maxOutputTokens'),timeoutMs:num('timeoutMs')});
  const thinking=raw.deepseekThinking;
  if(thinking!==undefined&&thinking!=='provider-default'&&thinking!=='disabled'&&thinking!=='enabled')throw new Error('DeepSeek 思考配置不合法。');
  resolveDeepSeekThinking({baseUrl,model,deepseekThinking:thinking});
  return {enabled:raw.enabled===true,model,providerLabel,baseUrl,...limits,...(thinking!==undefined?{deepseekThinking:thinking}:{})};
}
function defaultProfile():StoredProfile{return {...metadataFrom(DEFAULT_BYOK_SETTINGS as unknown as Record<string,unknown>),profileId:DEFAULT_ID,revision:'initial-default'};}
function parseStored(raw:unknown):StoredProfile{
  const r=asRecord(raw);
  if((r.profileId!==DEFAULT_ID&&(typeof r.profileId!=='string'||!UUID.test(r.profileId)))||typeof r.revision!=='string'||!UUID.test(r.revision)||typeof r.enabled!=='boolean'||typeof r.model!=='string'||!r.model.trim()||typeof r.baseUrl!=='string'||typeof r.providerLabel!=='string'||'apiKey' in r)throw new Error('模型档案格式损坏。');
  if(r.encryptedApiKey!==undefined&&(typeof r.encryptedApiKey!=='string'||r.encryptedApiKey.length>MAX_ENCRYPTED_KEY_CHARS||!r.encryptedApiKey))throw new Error('模型档案密文无效。');
  return {...metadataFrom(r),profileId:r.profileId as string,revision:r.revision, ...(typeof r.encryptedApiKey==='string'?{encryptedApiKey:r.encryptedApiKey}:{})};
}
export class AiSettingsStore{
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private readonly filePath:string,private readonly codec:CredentialCodec){}
  // Read may migrate a legacy plaintext file. Use the existing workspace lock
  // for the whole read/CAS/publish operation, including across desktop processes.
  private locked<T>(work:()=>Promise<T>):Promise<T>{
    const result=this.tail.then(()=>withResumeWriteLock(path.dirname(this.filePath),work));
    this.tail=result.then(()=>undefined,()=>undefined);return result;
  }
  private requireEncryption(){if(!this.codec.available())throw new Error('系统密钥加密当前不可用，未保存或覆盖密钥。');}
  private encrypt(key:string):string{
    this.requireEncryption();
    if(key.length>MAX_KEY_CHARS)throw new Error('API Key 长度超出许可范围。');
    try{
      const encrypted=this.codec.encrypt(key).toString('base64');
      if(!encrypted||encrypted.length>MAX_ENCRYPTED_KEY_CHARS)throw Error('invalid encrypted key');
      return encrypted;
    }catch{throw new Error('系统密钥加密失败，原配置未覆盖。');}
  }
  private decrypt(profile:StoredProfile):string{
    if(!profile.encryptedApiKey)return '';
    this.requireEncryption();
    try{
      if(profile.encryptedApiKey.length>MAX_ENCRYPTED_KEY_CHARS)throw Error('encrypted key limit');
      const key=this.codec.decrypt(Buffer.from(profile.encryptedApiKey,'base64'));
      if(!key.trim()||key.length>MAX_KEY_CHARS)throw Error('invalid decrypted key');
      return key;
    }catch{throw new Error('无法解密此模型档案密钥，原文件未修改。');}
  }
  private async inspectFile():Promise<Stats|null>{
    let st:Stats;
    try{st=await fs.lstat(this.filePath);}
    catch(err){
      if((err as NodeJS.ErrnoException).code==='ENOENT')return null;
      throw new Error('无法检查 AI 配置，原文件未修改。');
    }
    // The configured workspace root is trusted; its managed credential file
    // must be an ordinary, independently owned entry, never a link or alias.
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<=0||st.size>MAX_CATALOG_BYTES)
      throw new Error('AI 配置文件不安全、为空或超限，原文件保留。');
    try{
      const expected=path.join(await fs.realpath(path.dirname(this.filePath)),path.basename(this.filePath));
      if(path.relative(expected,await fs.realpath(this.filePath))!=='')throw Error('unsafe path');
    }catch{throw new Error('AI 配置路径不安全或已变化，原文件保留。');}
    return st;
  }
  private async readBytes(basis:Stats):Promise<string>{
    try{
      const handle=await fs.open(this.filePath,'r');
      try{
        const opened=await handle.stat();
        if(!opened.isFile()||!sameBasis(basis,opened))throw Error('changed before read');
        const bytes=Buffer.alloc(opened.size);let offset=0;
        while(offset<bytes.length){
          const {bytesRead}=await handle.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);
          if(!bytesRead)throw Error('short read');offset+=bytesRead;
        }
        if(!sameBasis(opened,await handle.stat())||!sameBasis(opened,await this.inspectFile()))throw Error('changed during read');
        return bytes.toString('utf8');
      }finally{await handle.close();}
    }catch{throw new Error('无法安全读取 AI 配置或文件已变化，原文件未修改。');}
  }
  private async write(value:Catalog,basis:Stats|null):Promise<Stats>{
    const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
    if(bytes.length>MAX_CATALOG_BYTES)throw new Error('AI 配置容量超限，原文件未覆盖。');
    const temp=this.filePath+'.'+randomUUID()+'.tmp';
    let created=false;
    try{
      const handle=await fs.open(temp,'wx',0o600);created=true;
      try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      // Cooperating writers hold the same workspace lock. Also reject any
      // observable change or unsafe target before replacing the original.
      if(!sameBasis(basis,await this.inspectFile()))throw new Error('AI 配置文件已变化，请重新读取，原文件未覆盖。');
      const staged=await fs.lstat(temp);
      await fs.rename(temp,this.filePath);created=false;
      try{
        const published=await this.inspectFile();
        if(!published||published.dev!==staged.dev||published.ino!==staged.ino||published.size!==bytes.length||
           await this.readBytes(published)!==bytes.toString('utf8'))throw Error('readback mismatch');
        return published;
      }catch{throw new Error('AI 配置已提交写入，但回读未确认；文件可能已更新，请重新读取核对。');}
    }finally{if(created)await fs.rm(temp,{force:true}).catch(()=>{});}
  }
  private async read():Promise<LoadedCatalog>{
    const basis=await this.inspectFile();
    if(!basis)return {catalog:{schemaVersion:2,activeProfileId:DEFAULT_ID,profiles:[defaultProfile()]},basis:null};
    const text=await this.readBytes(basis);
    let raw:Record<string,unknown>;
    try{raw=asRecord(JSON.parse(text));}catch{throw new Error('AI 配置损坏，原文件未修改。');}
    if(raw.schemaVersion===2){
      if(!Array.isArray(raw.profiles)||raw.profiles.length<1||raw.profiles.length>24)throw new Error('模型档案数量非法。');
      const profiles=raw.profiles.map(parseStored);
      if(new Set(profiles.map(p=>p.profileId)).size!==profiles.length||!profiles.some(p=>p.profileId===raw.activeProfileId))throw new Error('模型档案索引损坏。');
      return {catalog:{schemaVersion:2,activeProfileId:raw.activeProfileId as string,profiles},basis};
    }
    if(raw.schemaVersion!==undefined&&raw.schemaVersion!==1)throw new Error('不支持此 AI 配置版本；原文件未修改。');
    // Legacy singleton migration. Preserve existing encrypted material; encrypt plaintext before atomic replacement.
    if(typeof raw.baseUrl!=='string'||typeof raw.model!=='string'||typeof raw.enabled!=='boolean'||(raw.encryptedApiKey!==undefined&&typeof raw.encryptedApiKey!=='string')||(raw.apiKey!==undefined&&typeof raw.apiKey!=='string'))throw new Error('旧模型配置格式无法确认，原文件未修改。');
    const metadata=metadataFrom(raw);
    let encryptedApiKey:string|undefined;
    if(typeof raw.encryptedApiKey==='string'&&raw.encryptedApiKey){
      const candidate={...metadata,profileId:DEFAULT_ID,revision:randomUUID(),encryptedApiKey:raw.encryptedApiKey};
      this.decrypt(candidate);encryptedApiKey=raw.encryptedApiKey;
    }else if(typeof raw.apiKey==='string'&&raw.apiKey.trim())encryptedApiKey=this.encrypt(raw.apiKey.trim());
    const value:Catalog={schemaVersion:2,activeProfileId:DEFAULT_ID,profiles:[{...metadata,profileId:DEFAULT_ID,revision:randomUUID(),...(encryptedApiKey?{encryptedApiKey}:{})}]};
    return {catalog:value,basis:await this.write(value,basis)};
  }
  private find(c:Catalog,id=c.activeProfileId):StoredProfile{const p=c.profiles.find(p=>p.profileId===id);if(!p)throw new Error('模型档案不存在，请重新读取。');return p;}
  private view(p:StoredProfile):ByokAiSettings{const {encryptedApiKey,...publicMeta}=p;return {...publicMeta,apiKey:'',hasApiKey:Boolean(encryptedApiKey)};}
  private catalog(c:Catalog):AiProfileCatalog{return {activeProfileId:c.activeProfileId,profiles:c.profiles.map(p=>this.view(p))};}
  getCatalog():Promise<AiProfileCatalog>{return this.locked(async()=>this.catalog((await this.read()).catalog));}
  getPublicSettings():Promise<ByokAiSettings>{return this.locked(async()=>this.view(this.find((await this.read()).catalog)));}
  getRequestSettings(id?:string,revision?:string):Promise<ByokAiSettings>{
    return this.locked(async()=>{const p=this.find((await this.read()).catalog,id);
      if(revision!==undefined&&p.revision!==revision)throw new Error('模型配置已变化，请重新预览确认。');
      return {...this.view(p),apiKey:this.decrypt(p)};});
  }
  save(input:unknown):Promise<ByokAiSettings>{
    return this.locked(async()=>{
      const raw=asRecord(input),{catalog:c,basis}=await this.read(),previous=this.find(c,typeof raw.profileId==='string'?raw.profileId:undefined);
      if(raw.revision!==previous.revision)throw new Error('模型配置已变化，请重新读取后保存。');
      if(typeof raw.model!=='string'||!raw.model.trim()||typeof raw.baseUrl!=='string'||!raw.baseUrl.trim())throw new Error('模型名与接口地址不能为空。');
      const metadata=metadataFrom(raw);
      const supplied=typeof raw.apiKey==='string'?raw.apiKey.trim():'';
      if(supplied.length>MAX_KEY_CHARS)throw new Error('API Key 长度超出许可范围。');
      const encryptedApiKey=raw.clearApiKey===true?undefined:supplied?this.encrypt(supplied):previous.baseUrl===metadata.baseUrl?previous.encryptedApiKey:undefined;
      const value={...metadata,profileId:previous.profileId,revision:randomUUID(),...(encryptedApiKey?{encryptedApiKey}:{})};
      const profiles=c.profiles.map(p=>p.profileId===value.profileId?value:p);
      // An untouched ephemeral default must become a real persisted revision before writing.
      await this.write({...c,profiles:profiles.map(p=>p.revision==='initial-default'?{...p,revision:randomUUID()}:p)},basis);
      return this.view(value);
    });
  }
  create(input:unknown):Promise<AiProfileCatalog>{
    return this.locked(async()=>{
      const raw=asRecord(input),{catalog:c,basis}=await this.read();
      if(c.profiles.length>=24)throw new Error('最多保存 24 个模型档案。');
      const metadata=metadataFrom({...raw,enabled:false});
      const value:StoredProfile={...metadata,profileId:randomUUID(),revision:randomUUID()};
      const next:Catalog={...c,activeProfileId:value.profileId,profiles:[...c.profiles.map(p=>p.revision==='initial-default'?{...p,revision:randomUUID()}:p),value]};
      await this.write(next,basis);return this.catalog(next);
    });
  }
  activate(id:string):Promise<AiProfileCatalog>{
    return this.locked(async()=>{const {catalog:c,basis}=await this.read();this.find(c,id);
      const next:Catalog={...c,activeProfileId:id,profiles:c.profiles.map(p=>p.revision==='initial-default'?{...p,revision:randomUUID()}:p)};
      await this.write(next,basis);return this.catalog(next);});
  }
  remove(id:string,revision:string,confirmation:unknown):Promise<AiProfileCatalog>{
    return this.locked(async()=>{
      const {catalog:c,basis}=await this.read(),p=this.find(c,id);
      if(confirmation!=='DELETE_AI_PROFILE'||p.revision!==revision)throw new Error('删除模型档案需要明确确认与最新版本。');
      if(c.profiles.length<=1||id===c.activeProfileId)throw new Error('请先切换至其他档案，再删除此档案。');
      const next={...c,profiles:c.profiles.filter(x=>x.profileId!==id)};
      await this.write(next,basis);return this.catalog(next);
    });
  }
}
