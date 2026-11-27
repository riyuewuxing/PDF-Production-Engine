import {afterEach,describe,expect,it,vi} from 'vitest';
import {requestByokCompletionDirect,requestByokCompletionDirectWithReceipt,requestByokCompletionWithReceipt,AiGatewayError,describeAiRequest,formatAiCompletionReceipt,supportsDeepSeekThinking,connectionProbeOptions,DEFAULT_BYOK_SETTINGS,type ByokAiSettings} from './byokAiClient';
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

describe('bounded completion receipts',()=>{
  it('reports actual provider model and token counters without recording prompts or reasoning',async()=>{
    const f=vi.fn(async()=>new Response(JSON.stringify({model:'mock-v2',usage:{prompt_tokens:32,completion_tokens:5,total_tokens:37,prompt_tokens_details:{cached_tokens:0}},choices:[{message:{content:'OK',reasoning_content:'do not retain'},finish_reason:'stop'}]})));
    vi.stubGlobal('fetch',f);
    const r=await requestByokCompletionDirectWithReceipt(options);
    expect(r.text).toBe('OK');
    expect(r.receipt).toMatchObject({requestedModel:'mock',reportedModel:'mock-v2',promptTokens:32,completionTokens:5,totalTokens:37,cachedInputTokens:0,maxOutputTokens:128,timeoutMs:1000});
    expect(r.receipt?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(formatAiCompletionReceipt(r.receipt)).toContain('与请求不同');
    expect(JSON.stringify(r.receipt)).not.toContain('do not retain');
    expect(JSON.stringify(r.receipt)).not.toContain('synthetic-test-key');
    expect(f).toHaveBeenCalledTimes(1);
    expect(describeAiRequest(settings,options)).toContain('128 输出 tokens · 1 秒');
  });
  it('does not invent missing or malformed counters or expose an echoed credential as the model',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({model:'synthetic-test-key',usage:{prompt_tokens:-1,completion_tokens:'2',total_tokens:1.5},choices:[{message:{content:'OK'}}]}))));
    const r=await requestByokCompletionDirectWithReceipt(options);
    expect(r.receipt?.reportedModel).toBeUndefined();
    expect(r.receipt?.promptTokens).toBeUndefined();
    expect(r.receipt?.completionTokens).toBeUndefined();
    expect(r.receipt?.totalTokens).toBeUndefined();
    expect(formatAiCompletionReceipt(r.receipt)).toContain('未报告');
  });
});

describe('failure receipt compatibility',()=>{
  it('keeps safe counters for a truncated or empty decoded reply, not the unusable partial text',async()=>{
    const payload={model:'mock-v3',usage:{prompt_tokens:100,completion_tokens:128,total_tokens:228,prompt_cache_hit_tokens:0},choices:[{message:{content:'PRIVATE_PARTIAL_TEXT',reasoning_content:'PRIVATE_REASONING'},finish_reason:'length'}]};
    const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload))).mockResolvedValueOnce(new Response(JSON.stringify({...payload,choices:[{message:{content:''}}]}))).mockResolvedValueOnce(new Response('provider private body',{status:429}));
    vi.stubGlobal('fetch',f);
    for(const code of ['LIMIT','FORMAT']){
      const error=await requestByokCompletionDirectWithReceipt(options).catch(e=>e);
      expect(error).toBeInstanceOf(AiGatewayError);
      expect(error).toMatchObject({code,receipt:{requestedModel:'mock',reportedModel:'mock-v3',promptTokens:100,completionTokens:128,totalTokens:228,cachedInputTokens:0}});
      expect(JSON.stringify(error)).not.toContain('PRIVATE_PARTIAL_TEXT');expect(JSON.stringify(error)).not.toContain('PRIVATE_REASONING');
    }
    const error=await requestByokCompletionDirectWithReceipt(options).catch(e=>e);
    expect(error).toMatchObject({code:'HTTP'});expect(error.receipt).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('selects structured failure transport before sending and never retries an error through older IPC',async()=>{
    const receipt={requestedModel:'mock',reportedModel:'mock-v3',totalTokens:228,latencyMs:15,maxOutputTokens:128,timeoutMs:1000};
    const newer=vi.fn(async()=>({ok:false,error:{code:'LIMIT',message:'bounded synthetic failure',receipt}}));
    const older=vi.fn(),legacy=vi.fn(),cancel=vi.fn();
    vi.stubGlobal('window',{resumeDesktop:{ai:{requestCompletionOutcome:newer,requestCompletionWithReceipt:older,requestCompletion:legacy,cancelCompletion:cancel}}});
    const desktop={...options,settings:{...settings,apiKey:'',profileId:'test-profile',revision:'test-revision'}};
    await expect(requestByokCompletionWithReceipt(desktop)).rejects.toMatchObject({code:'LIMIT',receipt});
    expect(newer).toHaveBeenCalledTimes(1);expect(older).not.toHaveBeenCalled();expect(legacy).not.toHaveBeenCalled();
  });
  it('uses a previous bridge exactly once and does not invent a receipt for string compatibility',async()=>{
    const legacy=vi.fn(async()=> 'old reply');
    vi.stubGlobal('window',{resumeDesktop:{ai:{requestCompletion:legacy,cancelCompletion:vi.fn()}}});
    const desktop={...options,settings:{...settings,apiKey:'',profileId:'test-profile',revision:'test-revision'}};
    expect(await requestByokCompletionWithReceipt(desktop)).toEqual({text:'old reply',receipt:null});
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
