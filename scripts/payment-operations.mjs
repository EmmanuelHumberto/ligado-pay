// Private operator CLI. No provider credentials, payer data or arbitrary HTTP destination.
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {loadProviderSecret} from '../dist/src/infrastructure/provider-secret.js';
const [action,...args]=process.argv.slice(2),options={};
try{
 if(!['list','get','retry','request','resolve'].includes(action))throw Error();
 for(let i=0;i<args.length;i++){
  const name=args[i];if(name==='--execute'){if(options[name])throw Error();options[name]=true;continue;}
  if(!['--config-file','--payment-id','--input-file','--attempt-id'].includes(name)||options[name]||!args[i+1]||args[i+1].startsWith('--'))throw Error();
  options[name]=args[++i];
 }
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 if(!isAbsolute(options['--config-file']??'')||(action!=='list'&&!uuid.test(options['--payment-id']??'')))throw Error();
 let body;
 if(['retry','request','resolve'].includes(action)){
  if(!isAbsolute(options['--input-file']??'')||!uuid.test(options['--attempt-id']??''))throw Error();
  const text=await readFile(options['--input-file'],'utf8');if(text.length>4096)throw Error();body=JSON.parse(text);
  const keys=action==='resolve'?['operationId','reasonCode','evidenceSha256']:action==='retry'?['orderNsu','transactionNsu','slug']:['kind','reasonCode','amountCents','evidenceSha256'];
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw Error();
  if(action==='retry'&&(!uuid.test(body.orderNsu)||body.orderNsu!==options['--payment-id']||!uuid.test(body.transactionNsu)||!/^[A-Za-z0-9_-]{1,128}$/.test(body.slug)))throw Error();
  if(action==='resolve'&&(!uuid.test(body.operationId)||!/^[A-Z_]{3,64}$/.test(body.reasonCode)||!/^[a-f0-9]{64}$/.test(body.evidenceSha256)))throw Error();
  if(action==='request'&&(!['REFUND_REQUEST','CANCEL_REQUEST','EVIDENCE_RECORDED'].includes(body.kind)||!/^[A-Z_]{3,64}$/.test(body.reasonCode)||
    (body.amountCents!==undefined&&(!Number.isSafeInteger(body.amountCents)||body.amountCents<1||body.amountCents>100000000))||
    (body.evidenceSha256!==undefined&&!/^[a-f0-9]{64}$/.test(body.evidenceSha256))))throw Error();
  if(!options['--execute']){console.log(JSON.stringify({mode:'PLAN_ONLY',action,paymentId:options['--payment-id'],input:body,
    financialStateChanged:false,providerRefundOrCancellationExecuted:false,nextStep:'Review, then repeat with --execute; request is not a completed refund/cancellation.'}));process.exit(0);}
 }
 const config=JSON.parse(await readFile(options['--config-file'],'utf8'));
 if(!isAbsolute(config.tokenFile??''))throw Error();
 const token=loadProviderSecret(config.tokenFile);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error();
 const route=action==='list'?'/v1/operations':'/v1/payments/'+options['--payment-id']+(action==='retry'?'/reconciliation':action==='resolve'?'/operations/'+body.operationId+'/resolve':'/operations');
 if(action==='resolve')delete body.operationId;
 const r=await fetch('http://127.0.0.1:3305'+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{
  authorization:'Bearer '+token,'content-type':'application/json',...(body?{'idempotency-key':options['--attempt-id']}:{})},body:body?JSON.stringify(body):undefined});
 const text=await r.text();if(text.length>65536)throw Error();const result=JSON.parse(text);
 if(r.status!==200){console.error(JSON.stringify({status:r.status,error:typeof result.error==='string'?result.error:'OPERATION_FAILED'}));process.exitCode=1;}
 else console.log(JSON.stringify(result));
}catch{console.error('Operation refused or unavailable. No credential displayed. Use list|get|retry|request|resolve with --config-file and the reviewed input/attempt files.');process.exitCode=1;}
