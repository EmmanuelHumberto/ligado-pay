import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNotificationIngress,readProxyKey,publicPath} from '../infra/vps/notification-ingress.mjs';
import {notificationSource} from '../dist/src/http/notification-proxy.js';

const key='A'.repeat(43),source='203.0.113.14';
async function fixture(t,options={}){
  let calls=0;const records=[];
  const server=createNotificationIngress({key,forward:async(url,init)=>{
    calls++;records.push({url,init});return new Response('private response',{status:202});
  },...options});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url='http://127.0.0.1:'+server.address().port;
  const send=(body='{}',headers={},path=publicPath,method='POST')=>fetch(url+path,{method,headers:{'content-type':'application/json','cf-connecting-ip':source,...headers},...(method==='GET'?{}:{body})});
  return {send,url,records,get calls(){return calls;}};
}

test('real gateway verifier accepts signed canonical body and ignores forged headers',async t=>{
  const f=await fixture(t);const body={order_nsu:'audit-only',text:'acentuação'};
  const r=await f.send(JSON.stringify(body,null,2),{'x-lp-signature':'forged','x-forwarded-for':'1.2.3.4'});
  assert.equal(r.status,202);assert.deepEqual(await r.json(),{accepted:true});assert.equal(f.calls,1);
  const {url,init}=f.records[0];assert.equal(url,'http://127.0.0.1:3305/webhooks/infinitepay');
  assert.equal(init.redirect,'error');assert.equal(init.body,JSON.stringify(body));
  assert.equal(notificationSource(init.headers,JSON.parse(init.body),key),source);
  assert.throws(()=>notificationSource(init.headers,{...body,text:'modified'},key));
});

test('wrong source, content, encoding and invalid JSON never reach gateway',async t=>{
  const f=await fixture(t);
  for(const [body,headers,status] of [
    ['{}',{'cf-connecting-ip':'not-an-ip'},400],['{}',{'content-type':'text/plain'},415],
    ['{}',{'content-encoding':'gzip'},415],['{invalid',{},400],
  ]){assert.equal((await f.send(body,headers)).status,status);}
  assert.equal(f.calls,0);
});

test('unrelated paths and methods are not a gateway proxy',async t=>{
  const f=await fixture(t);
  assert.equal((await f.send('{}',{},'/v1/payments')).status,404);
  assert.equal((await f.send('{}',{},publicPath,'PUT')).status,405);
  assert.equal((await f.send('{}',{},publicPath+'?destination=other')).status,404);
  assert.equal(f.calls,0);assert.equal((await fetch(f.url+'/health/ready')).status,200);
});

test('body limit holds for declared and streamed bodies',async t=>{
  const f=await fixture(t);
  assert.equal((await f.send(JSON.stringify({x:'a'.repeat(33000)}))).status,413);
  const status=await new Promise((resolve,reject)=>{
    const r=http.request(f.url+publicPath,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':source}},res=>{res.resume();resolve(res.statusCode);});
    r.on('error',reject);r.write(' '.repeat(16000));r.write(' '.repeat(18000));r.end();
  });
  assert.equal(status,413);assert.equal(f.calls,0);
});

test('per-IP and global bounds reject, then reset in a new window',async t=>{
  let now=Date.now();const f=await fixture(t,{now:()=>now,perIp:1,globalLimit:2});
  assert.equal((await f.send()).status,202);assert.equal((await f.send()).status,429);
  assert.equal((await f.send('{}',{'cf-connecting-ip':'203.0.113.15'})).status,429);
  now+=60000;assert.equal((await f.send()).status,202);
});

test('bounded IP map refuses new sources until the next window',async t=>{
  let now=Date.now();const f=await fixture(t,{now:()=>now,maxBuckets:1});
  assert.equal((await f.send()).status,202);
  assert.equal((await f.send('{}',{'cf-connecting-ip':'203.0.113.15'})).status,429);
  now+=60000;assert.equal((await f.send('{}',{'cf-connecting-ip':'203.0.113.15'})).status,202);
});

test('upstream failures and redirects do not leak response bodies or secrets',async t=>{
  for(const forward of [async()=>{throw Error('secret '+key);},async()=>new Response('secret '+key,{status:503}),async()=>new Response('private',{status:302})]){
    const f=await fixture(t,{forward});const r=await f.send();assert.equal(r.status,503);
    const body=await r.text();assert.ok(!body.includes(key));assert.ok(!body.includes('private'));
  }
});

test('secret file ownership, permissions and symlink are checked on Linux',{skip:process.platform!=='linux'},()=>{
  const folder=mkdtempSync(join(tmpdir(),'pay-ingress-'));const file=join(folder,'key');
  try{
    writeFileSync(file,key,{mode:0o600});assert.equal(readProxyKey(file),key);
    chmodSync(file,0o644);assert.throws(()=>readProxyKey(file));chmodSync(file,0o600);
    symlinkSync(file,join(folder,'link'));assert.throws(()=>readProxyKey(join(folder,'link')));
    writeFileSync(file,'invalid');assert.throws(()=>readProxyKey(file));
  }finally{rmSync(folder,{recursive:true,force:true});}
});
