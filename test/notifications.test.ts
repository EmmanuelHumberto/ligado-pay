import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {notificationHints} from '../src/infrastructure/infinitepay/notifications.js';
test('notification keeps only correlation hints; claims, values, personal data and URLs never confirm',()=>{
  const order=randomUUID(),transaction=randomUUID();
  const result=notificationHints({order_nsu:order,transaction_nsu:transaction,invoice_slug:'invoice-1',
    paid:true,amount:9999,receipt_url:'http://attacker.invalid',customer:{name:'ignored'}});
  assert.deepEqual(result,{orderNsu:order,transactionNsu:transaction,slug:'invoice-1'});
  for(const bad of [null,[],{}, {order_nsu:order,transaction_nsu:transaction,invoice_slug:'bad/path'},
    {order_nsu:order,transaction_nsu:transaction,invoice_slug:'one',slug:'two'},
    {order_nsu:order,transaction_nsu:'invalid',invoice_slug:'one'}])assert.throws(()=>notificationHints(bad));
});
