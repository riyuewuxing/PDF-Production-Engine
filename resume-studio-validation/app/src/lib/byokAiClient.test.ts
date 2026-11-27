import {afterEach,describe,expect,it,vi} from 'vitest';
import {requestByokCompletionDirect,supportsDeepSeekThinking,connectionProbeOptions,DEFAULT_BYOK_SETTINGS,type ByokAiSettings} from './byokAiClient';
const settings:ByokAiSettings={enabled:true,providerLabel:'Mock',baseUrl:'https://example.invalid/v1',apiKey:'synthetic-test-key',model:'mock',contextBudgetChars:1000,maxOutputTokens:128,timeoutMs:1000};
const options={settings,systemPrompt:'system',userPrompt:'synthetic payload',maxTokens:300};
afterEach(()=>vi.unstubAllGlobals());
describe('bounded compatible provider gateway',()=>{
  it('uses the chosen exact endpoint, bearer credential and capped output budget without redirects',async()=>{
    const fetchMock=vi.fn(async(_url:string,_init:RequestInit)=>new Response(JSON.stringify({choices:[{message:{content:'synthetic reply'},finish_reason:'stop'}]}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    expect(await requestByokCompletionDirect(options)).toBe('synthetic reply');
    const [url,init]=fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.invalid/v1/chat/completions');
    expect(init.redirect).toBe('error');expect(init.headers).toMatchObject({Authorization:'Bearer synthetic-test-key'});
    expect(JSON.parse(String(init.body))).toMatchObject({model:'mock',max_tokens:128,messages:[{role:'system',content:'system'},{role:'user',content:'synthetic payload'}]});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('refuses an over-budget prompt before sending and never silently truncates',async()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    await expect(requestByokCompletionDirect({...options,userPrompt:'x'.repeat(1000)})).rejects.toThrow('字符预算');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not expose provider error bodies, redirect or retry a failed request',async()=>{
    const fetchMock=vi.fn(async()=>new Response('secret echo synthetic-test-key',{status:401}));vi.stubGlobal('fetch',fetchMock);
    await expect(requestByokCompletionDirect(options)).rejects.toMatchObject({code:'HTTP',message:'身份验证或权限失败 (HTTP 401)'});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete, non-text, malformed and oversized responses',async()=>{
    const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:'partial'},finish_reason:'length'}]}))).mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:['not text']}}]}))).mockResolvedValueOnce(new Response('invalid JSON')).mockResolvedValueOnce(new Response('x'.repeat(2*1024*1024+1)));
    vi.stubGlobal('fetch',f);
    await expect(requestByokCompletionDirect(options)).rejects.toMatchObject({code:'LIMIT'});
    for(let i=0;i<3;i++)await expect(requestByokCompletionDirect(options)).rejects.toMatchObject({code:'FORMAT'});
  });
  it('cancels an active request without automatic failover',async()=>{
    const f=vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
    vi.stubGlobal('fetch',f);const controller=new AbortController();
    const pending=requestByokCompletionDirect({...options,signal:controller.signal});
    controller.abort();
    await expect(pending).rejects.toMatchObject({code:'CANCELLED'});expect(f).toHaveBeenCalledTimes(1);
  });
  it('enforces the configured wall-clock timeout',async()=>{
    vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})));
    await expect(requestByokCompletionDirect(options)).rejects.toMatchObject({code:'TIMEOUT'});
  },3000);
});

describe('official DeepSeek explicit thinking compatibility',()=>{
  const deep={...settings,baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash'};
  it('uses the current default for new profiles without modifying provider-default requests',async()=>{
    expect(DEFAULT_BYOK_SETTINGS.model).toBe('deepseek-flash');expect(DEFAULT_BYOK_SETTINGS.deepseekThinking).toBe('disabled');
    const f=vi.fn(async(_url:string,_init:RequestInit)=>new Response(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]})));
    vi.stubGlobal('fetch',f);
    await requestByokCompletionDirect({...options,settings:deep});
    expect(JSON.parse(String(f.mock.calls[0]![1].body))).not.toHaveProperty('thinking');
    await requestByokCompletionDirect({...options,settings:{...deep,deepseekThinking:'disabled'}});
    expect(JSON.parse(String(f.mock.calls[1]![1].body))).toMatchObject({model:'deepseek-flash',thinking:{type:'disabled'}});
    await requestByokCompletionDirect({...options,settings:{...deep,model:'deepseek-v4-pro',deepseekThinking:'enabled'}});
    expect(JSON.parse(String(f.mock.calls[2]![1].body))).toMatchObject({model:'deepseek-v4-pro',thinking:{type:'enabled'}});
  });
  it('never sends the vendor-specific parameter to an arbitrary compatible URL or unsupported model',async()=>{
    const f=vi.fn();vi.stubGlobal('fetch',f);
    for(const changed of [{baseUrl:'https://api.deepseek.com.example.invalid/v1'},{baseUrl:'https://api.deepseek.com/beta'},{baseUrl:'https://api.deepseek.com:444/v1'},{model:'deepseek-chat'}]){
      const next={...deep,...changed,deepseekThinking:'disabled' as const};
      expect(supportsDeepSeekThinking(next.baseUrl,next.model)).toBe(false);
      await expect(requestByokCompletionDirect({...options,settings:next})).rejects.toThrow('思考配置');
    }
    expect(f).not.toHaveBeenCalled();
  });
  it('keeps probes synthetic and selects bounded budget according to the saved mode',()=>{
    expect(connectionProbeOptions({...deep,deepseekThinking:'disabled'}).maxTokens).toBe(64);
    expect(connectionProbeOptions({...deep,deepseekThinking:'enabled'}).maxTokens).toBe(1024);
    expect(connectionProbeOptions(deep).maxTokens).toBe(1024);
    expect(connectionProbeOptions(settings).maxTokens).toBe(64);
  });
});
