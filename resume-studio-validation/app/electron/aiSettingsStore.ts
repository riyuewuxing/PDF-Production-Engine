import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DEFAULT_BYOK_SETTINGS,resolveAiLimits,validateByokBaseUrl,type ByokAiSettings,type AiProfileCatalog} from '../src/lib/byokAiClient';

export interface CredentialCodec {available:()=>boolean;encrypt:(text:string)=>Buffer;decrypt:(bytes:Buffer)=>string}
type Meta=Pick<ByokAiSettings,'enabled'|'providerLabel'|'baseUrl'|'model'|'contextBudgetChars'|'maxOutputTokens'|'timeoutMs'>;
type StoredProfile=Meta&{profileId:string;revision:string;encryptedApiKey?:string};
type Catalog={schemaVersion:2;activeProfileId:string;profiles:StoredProfile[]};
const DEFAULT_ID='default';
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
  return {enabled:raw.enabled===true,model,providerLabel,baseUrl,...limits};
}
function defaultProfile():StoredProfile{return {...metadataFrom(DEFAULT_BYOK_SETTINGS as unknown as Record<string,unknown>),profileId:DEFAULT_ID,revision:'initial-default'};}
function parseStored(raw:unknown):StoredProfile{
  const r=asRecord(raw);
  if((r.profileId!==DEFAULT_ID&&(typeof r.profileId!=='string'||!UUID.test(r.profileId)))||typeof r.revision!=='string'||!UUID.test(r.revision)||typeof r.enabled!=='boolean'||typeof r.model!=='string'||!r.model.trim()||typeof r.baseUrl!=='string'||typeof r.providerLabel!=='string'||'apiKey' in r)throw new Error('模型档案格式损坏。');
  if(r.encryptedApiKey!==undefined&&(typeof r.encryptedApiKey!=='string'||r.encryptedApiKey.length>32768||!r.encryptedApiKey))throw new Error('模型档案密文无效。');
  return {...metadataFrom(r),profileId:r.profileId as string,revision:r.revision, ...(typeof r.encryptedApiKey==='string'?{encryptedApiKey:r.encryptedApiKey}:{})};
}
export class AiSettingsStore{
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private readonly filePath:string,private readonly codec:CredentialCodec){}
  private locked<T>(work:()=>Promise<T>):Promise<T>{const result=this.tail.then(work);this.tail=result.then(()=>undefined,()=>undefined);return result;}
  private requireEncryption(){if(!this.codec.available())throw new Error('系统密钥加密当前不可用，未保存或覆盖密钥。');}
  private encrypt(key:string):string{this.requireEncryption();try{return this.codec.encrypt(key).toString('base64');}catch{throw new Error('系统密钥加密失败，原配置未覆盖。');}}
  private decrypt(profile:StoredProfile):string{if(!profile.encryptedApiKey)return '';this.requireEncryption();try{return this.codec.decrypt(Buffer.from(profile.encryptedApiKey,'base64'));}catch{throw new Error('无法解密此模型档案密钥，原文件未修改。');}}
  private async write(value:Catalog){
    await fs.mkdir(path.dirname(this.filePath),{recursive:true});
    const temp=this.filePath+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temp,this.filePath);}
    finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  }
  private async read():Promise<Catalog>{
    let text:string;
    try{text=await fs.readFile(this.filePath,'utf8');}
    catch(err){if((err as NodeJS.ErrnoException).code==='ENOENT')return {schemaVersion:2,activeProfileId:DEFAULT_ID,profiles:[defaultProfile()]};throw new Error('无法读取 AI 配置，原文件未修改。');}
    let raw:Record<string,unknown>;
    try{raw=asRecord(JSON.parse(text));}catch{throw new Error('AI 配置损坏，原文件未修改。');}
    if(raw.schemaVersion===2){
      if(!Array.isArray(raw.profiles)||raw.profiles.length<1||raw.profiles.length>24)throw new Error('模型档案数量非法。');
      const profiles=raw.profiles.map(parseStored);
      if(new Set(profiles.map(p=>p.profileId)).size!==profiles.length||!profiles.some(p=>p.profileId===raw.activeProfileId))throw new Error('模型档案索引损坏。');
      return {schemaVersion:2,activeProfileId:raw.activeProfileId as string,profiles};
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
    await this.write(value);return value;
  }
  private find(c:Catalog,id=c.activeProfileId):StoredProfile{const p=c.profiles.find(p=>p.profileId===id);if(!p)throw new Error('模型档案不存在，请重新读取。');return p;}
  private view(p:StoredProfile):ByokAiSettings{const {encryptedApiKey,...publicMeta}=p;return {...publicMeta,apiKey:'',hasApiKey:Boolean(encryptedApiKey)};}
  private catalog(c:Catalog):AiProfileCatalog{return {activeProfileId:c.activeProfileId,profiles:c.profiles.map(p=>this.view(p))};}
  getCatalog():Promise<AiProfileCatalog>{return this.locked(async()=>this.catalog(await this.read()));}
  getPublicSettings():Promise<ByokAiSettings>{return this.locked(async()=>this.view(this.find(await this.read())));}
  getRequestSettings(id?:string,revision?:string):Promise<ByokAiSettings>{
    return this.locked(async()=>{const p=this.find(await this.read(),id);
      if(revision!==undefined&&p.revision!==revision)throw new Error('模型配置已变化，请重新预览确认。');
      return {...this.view(p),apiKey:this.decrypt(p)};});
  }
  save(input:unknown):Promise<ByokAiSettings>{
    return this.locked(async()=>{
      const raw=asRecord(input),c=await this.read(),previous=this.find(c,typeof raw.profileId==='string'?raw.profileId:undefined);
      if(raw.revision!==previous.revision)throw new Error('模型配置已变化，请重新读取后保存。');
      if(typeof raw.model!=='string'||!raw.model.trim()||typeof raw.baseUrl!=='string'||!raw.baseUrl.trim())throw new Error('模型名与接口地址不能为空。');
      const metadata=metadataFrom(raw);
      const supplied=typeof raw.apiKey==='string'?raw.apiKey.trim():'';
      if(supplied.length>4096)throw new Error('API Key 长度超出许可范围。');
      const encryptedApiKey=raw.clearApiKey===true?undefined:supplied?this.encrypt(supplied):previous.baseUrl===metadata.baseUrl?previous.encryptedApiKey:undefined;
      const value={...metadata,profileId:previous.profileId,revision:randomUUID(),...(encryptedApiKey?{encryptedApiKey}:{})};
      const profiles=c.profiles.map(p=>p.profileId===value.profileId?value:p);
      // An untouched ephemeral default must become a real persisted revision before writing.
      await this.write({...c,profiles:profiles.map(p=>p.revision==='initial-default'?{...p,revision:randomUUID()}:p)});
      return this.view(value);
    });
  }
  create(input:unknown):Promise<AiProfileCatalog>{
    return this.locked(async()=>{
      const raw=asRecord(input),c=await this.read();
      if(c.profiles.length>=24)throw new Error('最多保存 24 个模型档案。');
      const metadata=metadataFrom({...raw,enabled:false});
      const value:StoredProfile={...metadata,profileId:randomUUID(),revision:randomUUID()};
      const next:Catalog={...c,activeProfileId:value.profileId,profiles:[...c.profiles.map(p=>p.revision==='initial-default'?{...p,revision:randomUUID()}:p),value]};
      await this.write(next);return this.catalog(next);
    });
  }
  activate(id:string):Promise<AiProfileCatalog>{
    return this.locked(async()=>{const c=await this.read();this.find(c,id);
      const next:Catalog={...c,activeProfileId:id,profiles:c.profiles.map(p=>p.revision==='initial-default'?{...p,revision:randomUUID()}:p)};
      await this.write(next);return this.catalog(next);});
  }
  remove(id:string,revision:string,confirmation:unknown):Promise<AiProfileCatalog>{
    return this.locked(async()=>{
      const c=await this.read(),p=this.find(c,id);
      if(confirmation!=='DELETE_AI_PROFILE'||p.revision!==revision)throw new Error('删除模型档案需要明确确认与最新版本。');
      if(c.profiles.length<=1||id===c.activeProfileId)throw new Error('请先切换至其他档案，再删除此档案。');
      const next={...c,profiles:c.profiles.filter(x=>x.profileId!==id)};
      await this.write(next);return this.catalog(next);
    });
  }
}
