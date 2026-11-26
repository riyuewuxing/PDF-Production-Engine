// Only synthetic probe content; never print or serialize credentials or provider response.
import fs from 'node:fs/promises';
import path from 'node:path';
import { requestByokCompletionDirect } from '../src/lib/byokAiClient';
const key=process.env.DEEPSEEK_SMOKE_KEY?.trim();
const out=process.env.RESUME_STUDIO_EVIDENCE_OUT;
if(!out)throw new Error('evidence path required');
const result:{attempted:boolean;success:boolean;responseNonempty?:boolean;exactOk?:boolean;errorCategory?:string;model:string}={attempted:Boolean(key),success:false,model:'deepseek-chat'};
if(key){
  try{
    const response=await requestByokCompletionDirect({
      settings:{enabled:true,providerLabel:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',apiKey:key,model:'deepseek-chat'},
      systemPrompt:'This is a connectivity test using entirely fictional data. Reply only OK.',
      userPrompt:'Synthetic candidate: Demo Person, fictional example school. Reply OK.',
      temperature:0,maxTokens:32,timeoutMs:25000,
    });
    result.responseNonempty=Boolean(response.trim());
    result.exactOk=response.trim()==='OK';
    result.success=result.responseNonempty;
  }catch(err){
    const msg=err instanceof Error?err.message:'';
    const status=/HTTP (\d{3})/.exec(msg)?.[1];
    result.errorCategory=status?'HTTP_'+status:err instanceof Error&&err.name==='AbortError'?'TIMEOUT_OR_ABORT':'TRANSPORT_OR_RESPONSE_ERROR';
  }
}else{result.errorCategory='SECRET_NOT_CONFIGURED';}
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'real-provider-probe.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
