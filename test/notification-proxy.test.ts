import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {notificationSource} from '../src/http/notification-proxy.js';
test('notification source requires authenticated fresh proxy metadata bound to body and path',()=>{
 const key=randomBytes(32).toString('base64url'),now=Date.now(),body={order_nsu:'synthetic'},time=String(now),source='198.51.100.3';
 const signature=createHmac('sha256',key).update(['POST','/webhooks/infinitepay',time,source,createHash('sha256').update(JSON.stringify(body)).digest('hex')].join('\n')).digest('hex');
 const headers={'x-lp-time':time,'x-lp-source':source,'x-lp-signature':signature};
 assert.equal(notificationSource(headers,body,key,now),source);
 for(const changed of [{...headers,'x-lp-source':'198.51.100.4'},{...headers,'x-lp-signature':'0'.repeat(64)},{}])
   assert.throws(()=>notificationSource(changed,body,key,now));
 assert.throws(()=>notificationSource(headers,{...body,paid:true},key,now));
 assert.throws(()=>notificationSource(headers,body,key,now+60001));
});
