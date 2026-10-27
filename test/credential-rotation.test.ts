import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {parseConfig} from '../src/config.js';
import {authenticate} from '../src/http/authentication.js';

const at=Date.parse('2026-10-27T12:00:00.000Z');
const oldToken=randomBytes(32).toString('base64url'),newToken=randomBytes(32).toString('base64url');
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
function fixture() {
 const scope={applicationId:'application-one',receiverIds:['receiver-one'],permissions:['payments:create','payments:read','payments:check'],
   maxAmountCents:1000,requestsPerMinute:10,maxPayments:5};
 return {mode:'local',provider:'simulated',environment:'sandbox',port:3305,
   databaseUrl:'postgresql://runtime:synthetic@127.0.0.1:55439/ligado_pay_test',credentials:[
     {...scope,keyHash:hash(oldToken),keyId:'key-old',notBefore:new Date(at).toISOString(),expiresAt:new Date(at+3600000).toISOString()},
     {...scope,keyHash:hash(newToken),keyId:'key-new',notBefore:new Date(at).toISOString(),expiresAt:undefined}]};
}
test('rotation preserves the financial principal, respects activation, expiry and revocation boundaries',()=>{
 const raw=fixture(),credentials=parseConfig(raw,'test').credentials;
 const old=authenticate('Bearer '+oldToken,credentials,at),fresh=authenticate('Bearer '+newToken,credentials,at);
 assert.deepEqual(old,fresh);
 assert.equal(old?.applicationId,'application-one');
 for(const field of ['keyId','keyHash','notBefore','expiresAt','revokedAt'])assert.equal(Object.hasOwn(old!,field),false);
 assert.equal(authenticate('Bearer '+newToken,credentials,at-1),null);
 assert.ok(authenticate('Bearer '+oldToken,credentials,at+3599999));
 assert.equal(authenticate('Bearer '+oldToken,credentials,at+3600000),null);
 assert.ok(authenticate('Bearer '+newToken,credentials,at+3600000));
 const revoked=parseConfig({...raw,credentials:[{...raw.credentials[0],revokedAt:new Date(at+1000).toISOString()},raw.credentials[1]]},'test').credentials;
 assert.ok(authenticate('Bearer '+oldToken,revoked,at+999));
 assert.equal(authenticate('Bearer '+oldToken,revoked,at+1000),null);
 assert.ok(authenticate('Bearer '+newToken,revoked,at+1000));
});
test('configuration refuses unlimited coexistence, policy escalation, ambiguous keys and malformed windows',()=>{
 const raw=fixture();
 const mutate=(change:Record<string,unknown>)=>({...raw,credentials:[raw.credentials[0],{...raw.credentials[1],...change}]});
 for(const change of [{keyId:'key-old'}, {keyHash:hash(oldToken)}, {keyId:undefined}, {notBefore:undefined},
   {notBefore:'invalid'}, {notBefore:'2026-02-30T12:00:00.000Z'},
   {notBefore:new Date(at+3600000).toISOString()}, {receiverIds:['receiver-two']},
   {permissions:['payments:read']}, {maxAmountCents:2000}, {requestsPerMinute:600}, {maxPayments:6},
   {readRequestsPerMinute:200}, {checkRequestsPerMinute:200}, {revokedAt:new Date(at-1).toISOString()}]) {
   assert.throws(()=>parseConfig(mutate(change),'test'));
 }
 assert.throws(()=>parseConfig({...raw,credentials:raw.credentials.map(c=>({...c,expiresAt:undefined}))},'test'));
 assert.throws(()=>parseConfig({...raw,credentials:[{...raw.credentials[0],expiresAt:new Date(at+86400001).toISOString()},raw.credentials[1]]},'test'));
 assert.throws(()=>parseConfig({...raw,credentials:[...raw.credentials,{...raw.credentials[1],keyId:'key-third',keyHash:hash('other')}]},'test'));
});
test('single legacy credential stays compatible and rolling back consumer selection preserves scope',()=>{
 const raw=fixture(),first=raw.credentials[0]!;
 const {keyId,notBefore,expiresAt,...legacy}=first;
 const previous=parseConfig({...raw,credentials:[legacy]},'test').credentials;
 const during=parseConfig(raw,'test').credentials;
 assert.deepEqual(authenticate('Bearer '+oldToken,previous,at),authenticate('Bearer '+newToken,during,at));
 assert.equal(authenticate('Bearer '+newToken,previous,at),null);
 assert.equal(authenticate('Bearer '+randomBytes(32).toString('base64url'),during,at),null);
});
