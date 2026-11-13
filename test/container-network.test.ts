import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parseConfig} from '../src/config.js';

const config=()=>({mode:'private-production',networkProfile:'private-container-v1',provider:'infinitepay',
  environment:'production',port:3305,databaseUrl:'postgresql://ligado_pay_runtime:synthetic-password@pay-db:55439/ligado_pay_local',
  credentials:[{applicationId:'app-test',receiverIds:['receiver-test'],keyHash:createHash('sha256').update('synthetic-credential').digest('hex'),
    permissions:['payments:create','payments:read','payments:check'],maxAmountCents:520000,requestsPerMinute:20}],
  infinitepay:{receiverId:'receiver-test',handle:'synthetic-merchant',liveCreationEnabled:false,
    apiKeyFile:resolve('.local/synthetic-key'),redirectUrl:'https://portal.example.com/return'}});

test('private container profile binds one database service without changing financial policy',()=>{
  const raw=config(),parsed=parseConfig(raw,'production');
  assert.equal(parsed.networkProfile,'private-container-v1');
  assert.equal(parsed.databaseUrl,raw.databaseUrl);
  assert.deepEqual(parsed.credentials[0]?.receiverIds,raw.credentials[0]?.receiverIds);
  assert.equal(parsed.credentials[0]?.maxAmountCents,raw.credentials[0]?.maxAmountCents);
  assert.equal(parsed.infinitepay?.liveCreationEnabled,false);
});

test('container profile never permits arbitrary hosts, database, port or environment',()=>{
  for(const change of [{networkProfile:'anything'},{networkProfile:null},{mode:'local'},
    {provider:'simulated'},{environment:'sandbox'},{port:443},
    ...['127.0.0.1','localhost','os-db','pay-db.evil.example','192.0.2.10'].map(host=>({databaseUrl:`postgresql://u:p@${host}:55439/ligado_pay_local`})),
    {databaseUrl:'postgresql://u:p@pay-db:5432/ligado_pay_local'},
    {databaseUrl:'postgresql://u:p@pay-db:55439/os_system'},
    {databaseUrl:'postgresql://restore_admin:p@pay-db:55439/ligado_pay_local'},
    {databaseUrl:'postgresql://u:p@pay-db:55439/ligado_pay_local?host=other'},
    {databaseUrl:'postgresql://u:p@pay-db:55439/ligado_pay_local#fragment'}]){
    assert.throws(()=>parseConfig({...config(),...change},'production'));
  }
  for(const env of [undefined,'development','test'])assert.throws(()=>parseConfig(config(),env));
});

test('legacy host profile remains explicit and cannot silently accept container DNS',()=>{
  const raw=config();const {networkProfile:_,...legacy}=raw;
  assert.throws(()=>parseConfig(legacy,'production'));
  const parsed=parseConfig({...legacy,databaseUrl:raw.databaseUrl.replace('@pay-db:', '@127.0.0.1:')},'production');
  assert.equal(parsed.networkProfile,undefined);
});
