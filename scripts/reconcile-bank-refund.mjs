import fs from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import pg from 'pg';
import {reconcileBankRefund,validateBankRefund} from '../dist/src/application/refund-reconciliation.js';
const args=process.argv.slice(2),options={};
try{
 for(let i=0;i<args.length;i++){
  const flag=args[i];if(options[flag])throw Error();
  if(['--execute','--confirm-infinitepay-reviewed'].includes(flag))options[flag]=true;
  else if(flag==='--input-file'&&args[i+1]&&!args[i+1].startsWith('--'))options[flag]=args[++i];
  else throw Error();
 }
 const inputFile=options['--input-file'];
 if(!inputFile||!isAbsolute(inputFile)||(await fs.stat(inputFile)).size>4096)throw Error();
 const input=JSON.parse(await fs.readFile(inputFile,'utf8'));
 if(Object.keys(input).sort().join(',')!==['id','paymentId','transactionNsu','providerRefundReference','amountCents','occurredAt','evidenceSha256'].sort().join(','))throw Error();
 validateBankRefund(input);
 if(!options['--execute'])console.log(JSON.stringify({action:'RECORD_BANK_REFUND_RECONCILIATION',paymentId:input.paymentId,amountCents:input.amountCents,moneyMoved:false,requiresBankAccountReview:true}));
 else{
  if(!options['--confirm-infinitepay-reviewed'])throw Error();
  const config=JSON.parse(await fs.readFile(new URL('../.local/migrations.json',import.meta.url),'utf8'));
  const url=new URL(config.databaseUrl);if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/ligado_pay_local')throw Error();
  const pool=new pg.Pool({connectionString:config.databaseUrl,max:1,connectionTimeoutMillis:5000,statement_timeout:5000});
  try{console.log(JSON.stringify(await reconcileBankRefund(pool,input)));}finally{await pool.end();}
 }
}catch{console.error('Reconciliation refused. No money moved or private values printed.');process.exitCode=1;}
