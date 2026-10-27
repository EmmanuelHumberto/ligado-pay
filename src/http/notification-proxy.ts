import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {PaymentError} from '../domain/payment.js';
export function notificationSource(headers:Record<string,string|string[]|undefined>,body:unknown,key:string,now=Date.now()) {
  const timestamp=headers['x-lp-time'],source=headers['x-lp-source'],signature=headers['x-lp-signature'];
  if(typeof timestamp!=='string'||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60000||
    typeof source!=='string'||!(source==='unknown'||isIP(source))||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))
    throw new PaymentError(403,'INVALID_NOTIFICATION_PROXY');
  const digest=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const expected=createHmac('sha256',key).update(['POST','/webhooks/infinitepay',timestamp,source,digest].join('\n')).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw new PaymentError(403,'INVALID_NOTIFICATION_PROXY');
  return source;
}
