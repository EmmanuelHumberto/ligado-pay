import {readFileSync} from 'node:fs';
import pg from 'pg';
import {migrate} from '../../dist/src/infrastructure/migrate.js';

// Deliberately unavailable as automatic runtime startup or a production migration command.
const file=JSON.parse(readFileSync('/preview/preview-state.json','utf8'));
if(file.purpose!=='synthetic-preview'||file.productionData!==false||process.env.CONFIRM_SYNTHETIC_PREVIEW!=='yes')throw Error('SYNTHETIC_PREVIEW_REQUIRED');
const pool=new pg.Pool({connectionString:file.payAdminUrl,max:1});
try{
 const existing=await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1");
 if(existing.rowCount)throw Error('EMPTY_DATABASE_REQUIRED');
 await migrate(pool);
 const password=file.payRuntimePassword;
 if(!/^[a-f0-9]{64}$/.test(password))throw Error('INVALID_GENERATED_PASSWORD');
 await pool.query(`CREATE ROLE ligado_pay_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
 await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
 await pool.query('GRANT USAGE ON SCHEMA public TO ligado_pay_runtime');
 for(const table of ['payments','request_limits','provider_settlements','payment_events','outbox','checkout_notifications','payment_operations','notification_discard_counts','operation_resolutions'])await pool.query('GRANT SELECT,INSERT ON '+table+' TO ligado_pay_runtime');
 for(const [table,columns] of [['payments','state,provider_reference,updated_at,checkout_url,review_reason'],['request_limits','attempts'],['outbox','delivered_at,attempts'],['checkout_notifications','state,attempts,next_check_at,lease_token,lease_until,trusted']])await pool.query('GRANT UPDATE('+columns+') ON '+table+' TO ligado_pay_runtime');
 await pool.query('GRANT DELETE ON checkout_notifications TO ligado_pay_runtime');
 await pool.query('GRANT UPDATE ON notification_discard_counts TO ligado_pay_runtime');
 await pool.query('GRANT SELECT ON bank_refund_reconciliations TO ligado_pay_runtime');
 console.log('SYNTHETIC_GATEWAY_DATABASE_READY');
}catch{console.error('SYNTHETIC_GATEWAY_INITIALIZATION_FAILED: private details omitted');process.exitCode=1;}
finally{await pool.end();}
