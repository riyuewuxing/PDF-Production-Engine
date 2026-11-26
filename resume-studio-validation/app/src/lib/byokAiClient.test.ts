import {afterEach,describe,expect,it,vi} from 'vitest';
import {requestByokCompletionDirect,type ByokAiSettings} from './byokAiClient';
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
