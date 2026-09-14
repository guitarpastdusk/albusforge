import { randomUUID } from 'node:crypto';
import { createDb, type DbConfig } from '@albusforge/db';
import { runMigrations } from '@albusforge/db/migrate';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { trackTestPool, closeTestPool } from '../../gateway/src/test-pool-shutdown.js';
import { observationHealth } from './health.js';
let container:StartedPostgreSqlContainer,pool:pg.Pool,clock:number;
beforeAll(async()=>{
 container=await new PostgreSqlContainer('postgres:16-alpine').withTmpFs({'/var/lib/postgresql/data':'rw,size=256m'}).start();
 const admin=new pg.Client({connectionString:container.getConnectionUri()});await admin.connect();
 await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'test-migrate'");await admin.query('CREATE DATABASE albus OWNER albus_migrate');await admin.end();
 const config:DbConfig={host:container.getHost(),port:container.getPort(),database:'albus',user:'albus_migrate',password:'test-migrate',ssl:'disable'};
 await runMigrations(config,{appRole:{name:'albus_app',password:'test-app'}});
 pool=trackTestPool(createDb({...config,user:'albus_app',password:'test-app'},{max:1,statementTimeoutMs:5000,queryTimeoutMs:6000}).pool);
});
beforeEach(async()=>{clock=Date.now();await pool.query('DELETE FROM users.tenants');await pool.query('DELETE FROM telemetry.observation_maintenance_state');await pool.query('DELETE FROM telemetry.observation_deletion_intents');});
afterAll(async()=>{await closeTestPool(pool);await container?.stop();});
async function camera(index=1){const device=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,tenant=randomUUID();
 await pool.query('INSERT INTO users.tenants(id,name) VALUES($1,$2)',[tenant,'health fixture']);
 await pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,'{}','{}')",[device,tenant,randomUUID()]);
 await pool.query("INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,max_bytes,max_width,max_height) VALUES($1,'camera','image','jpeg.v1','test-camera',1,900,1048576,320,240)",[device]);return device;
}
async function old(device:string){await pool.query("UPDATE telemetry.device_capabilities SET monitoring_started_at=$2 WHERE device_id=$1",[device,new Date(clock-7200000)]);}
async function health(limit=100){const c=await pool.connect();try{return await observationHealth(c,new Date(clock),limit);}finally{c.release();}}
it('suppresses startup and re-enable grace without ordinary updates resetting the clock',async()=>{
 const device=await camera();expect((await health()).camera_stale_count).toBe(0);await old(device);
 await pool.query('UPDATE telemetry.device_capabilities SET enabled=true WHERE device_id=$1',[device]);expect((await health()).camera_stale_count).toBe(1);
 await pool.query('UPDATE telemetry.device_capabilities SET enabled=false WHERE device_id=$1',[device]);expect((await health()).camera_enabled_count).toBe(0);
 await pool.query('UPDATE telemetry.device_capabilities SET enabled=true WHERE device_id=$1',[device]);expect((await health()).camera_stale_count).toBe(0);
});
it('uses both capture and arrival age, exact 35-minute boundary, and excludes revoked devices',async()=>{
 const device=await camera();await old(device);
 await pool.query("INSERT INTO telemetry.capability_presence(device_id,capability_id,last_capture_at,last_received_at) VALUES($1,'camera',$2,$3)",[device,new Date(clock-2100000),new Date(clock)]);
 expect((await health()).camera_stale_count).toBe(0);clock+=1000;expect((await health()).camera_stale_count).toBe(1);
 await pool.query('UPDATE telemetry.capability_presence SET last_capture_at=$2,last_received_at=$3 WHERE device_id=$1',[device,new Date(clock),new Date(clock-2101000)]);expect((await health()).camera_stale_count).toBe(1);
 await pool.query('UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1',[device]);expect((await health()).camera_enabled_count).toBe(0);
});
it('accumulates stale cameras across pages; healthy partial pages cannot clear a completed result',async()=>{
 const first=await camera(1);await old(first);await camera(2);await camera(3);
 const a=await health(1);expect(a.camera_scan_complete).toBe(false);expect(a.camera_stale_count).toBeUndefined();
 clock+=1000;const b=await health(1);expect(b.camera_scan_complete).toBe(false);expect(b.camera_stale_count).toBeUndefined();
 const c=await health(1);expect(c.camera_scan_complete).toBe(true);expect(c.camera_stale_count).toBe(1);expect(c.camera_scan_age_s).toBe(1);
 expect((await health(1)).camera_stale_count).toBeUndefined();
});
it('reports capped deletion lower bounds and oldest age without scanning the full queue',async()=>{
 for(let i=0;i<4;i++)await pool.query('INSERT INTO telemetry.observation_deletion_intents(object_key,queued_at) VALUES($1,$2)',[`test/${i}`,new Date(clock-(i+1)*1000)]);
 expect(await health(2)).toMatchObject({deletion_backlog_lower_bound:3,deletion_backlog_capped:true,deletion_oldest_age_s:4,reservation_overdue_age_s:0});
});

it('reports the oldest overdue reservation and resets grace after cadence changes',async()=>{
 const device=await camera(),id=randomUUID();await old(device);
 await pool.query(`INSERT INTO telemetry.observation_receipts(device_id,observation_id,capability_id,fingerprint,sha256,bytes,captured_at,expires_at,state,lease_id,lease_until,reserved_day) VALUES($1,$2,'camera',$3,$3,10,$4,$5,'reserved',$6,$7,'2026-09-14')`,[device,id,'a'.repeat(64),new Date(clock-10000),new Date(clock+86400000),randomUUID(),new Date(clock-3000)]);
 expect((await health()).reservation_overdue_age_s).toBe(3);
 await pool.query('UPDATE telemetry.device_capabilities SET interval_s=1800 WHERE device_id=$1',[device]);
 expect((await health()).camera_stale_count).toBe(0);
});
