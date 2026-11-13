import {createServer} from 'node:http';
import {createHash,createHmac} from 'node:crypto';
import {constants,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
import {isIP} from 'node:net';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

export const publicPath='/ligado-pay/webhooks/infinitepay';
const downstream='http://127.0.0.1:3305/webhooks/infinitepay';
const keyPattern=/^[A-Za-z0-9_-]{43}$/;

export function readProxyKey(file){
  if(process.platform!=='linux'||typeof file!=='string'||!isAbsolute(file))throw Error('Proxy key unavailable');
  let fd;
  try{
    fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    const info=fstatSync(fd);
    if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid()||(info.mode&0o077)!==0||info.size>128)throw Error();
    const key=readFileSync(fd,'utf8').trim();if(!keyPattern.test(key))throw Error();return key;
  }catch{throw Error('Proxy key unavailable');}
  finally{if(fd!==undefined)closeSync(fd);}
}

export function createNotificationIngress({key,forward=fetch,now=Date.now,perIp=120,globalLimit=600,maxBuckets=10000}={}){
  if(typeof key!=='string'||!keyPattern.test(key)||![perIp,globalLimit,maxBuckets].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('Invalid ingress configuration');
  const buckets=new Map();let globalWindow=-1,globalCount=0;
  const server=createServer(async(request,response)=>{
    const reply=(status,body)=>{
      if(response.destroyed||response.headersSent)return;
      response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','connection':'close'});
      response.end(JSON.stringify(body));
    };
    try{
      if(request.url==='/health/ready'&&request.method==='GET')return reply(200,{status:'ready'});
      if(request.url!==publicPath)return reply(404,{error:'NOT_FOUND'});
      if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
      const source=request.headers['cf-connecting-ip'];
      if(typeof source!=='string'||!isIP(source))return reply(400,{error:'INVALID_SOURCE'});
      const window=Math.floor(now()/60000);
      if(window!==globalWindow){globalWindow=window;globalCount=0;}
      if(++globalCount>globalLimit)return reply(429,{error:'RATE_LIMITED'});
      if(buckets.size>=maxBuckets)for(const [ip,bucket] of buckets)if(bucket.window!==window)buckets.delete(ip);
      const previous=buckets.get(source),count=previous?.window===window?previous.count+1:1;
      if(count>perIp||(!previous&&buckets.size>=maxBuckets))return reply(429,{error:'RATE_LIMITED'});
      buckets.set(source,{window,count});
      if((request.headers['content-encoding']&&request.headers['content-encoding']!=='identity')||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type']??''))return reply(415,{error:'INVALID_REQUEST'});
      const length=request.headers['content-length'];
      if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>32768)){
        reply(413,{error:'INVALID_REQUEST'});response.once('finish',()=>request.destroy());return;
      }
      const chunks=[];let size=0;
      for await(const chunk of request){
        size+=chunk.length;
        if(size>32768){reply(413,{error:'INVALID_REQUEST'});response.once('finish',()=>request.destroy());return;}
        chunks.push(chunk);
      }
      let body;
      try{body=JSON.stringify(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}
      catch{return reply(400,{error:'INVALID_REQUEST'});}
      const timestamp=String(now());
      const signature=createHmac('sha256',key).update(['POST','/webhooks/infinitepay',timestamp,source,createHash('sha256').update(body).digest('hex')].join('\n')).digest('hex');
      const result=await forward(downstream,{method:'POST',headers:{'content-type':'application/json','x-lp-time':timestamp,'x-lp-source':source,'x-lp-signature':signature},body,redirect:'error',signal:AbortSignal.timeout(8000)});
      await result.body?.cancel();
      const status=result.status;
      if(!Number.isInteger(status)||status<200||status>599||status>=300&&status<400)return reply(503,{error:'SERVICE_UNAVAILABLE'});
      return reply(status,status<300?{accepted:true}:{error:'NOTIFICATION_NOT_ACCEPTED'});
    }catch{return reply(503,{error:'SERVICE_UNAVAILABLE'});}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;server.keepAliveTimeout=1000;server.maxConnections=64;
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.getuid?.()!==10009)throw Error();
    const key=readProxyKey(process.env.LIGADO_NOTIFICATION_KEY_FILE);
    const server=createNotificationIngress({key});
    server.listen(3344,'127.0.0.1',()=>console.log('Notification ingress ready on loopback.'));
    process.on('SIGTERM',()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),12000).unref();});
  }catch{console.error('Notification ingress unavailable; private details omitted.');process.exitCode=1;}
}
