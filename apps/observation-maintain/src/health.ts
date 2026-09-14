import type { PoolClient } from 'pg';
interface ScanState {health_device_cursor:string|null;health_capability_cursor:string|null;health_scan_started_at:Date|null;health_enabled_count:number;health_stale_count:number}
interface Capability {device_id:string;capability_id:string;kind:string;enabled:boolean;revoked_at:Date|null;interval_s:number;monitoring_started_at:Date;last_capture_at:Date|null;last_received_at:Date|null}
export interface ObservationHealth {deletion_backlog_lower_bound:number;deletion_backlog_capped:boolean;deletion_oldest_age_s:number;reservation_overdue_age_s:number;camera_scan_complete:boolean;camera_scan_age_s:number;camera_enabled_count?:number;camera_stale_count?:number}
/** Called under the existing maintenance advisory lock, with its existing client.
 * LIMIT precedes joins/filtering so even a fleet with no cameras is bounded.
 * No healthy partial-page result can overwrite a completed stale sweep. */
export async function observationHealth(client:PoolClient,time:Date,limit:number,signal?:AbortSignal):Promise<ObservationHealth> {
 signal?.throwIfAborted();
 const backlog=(await client.query<{queued_at:Date}>('SELECT queued_at FROM telemetry.observation_deletion_intents ORDER BY queued_at LIMIT $1',[limit+1])).rows;
 signal?.throwIfAborted();
 const lease=(await client.query<{lease_until:Date}>("SELECT lease_until FROM telemetry.observation_receipts WHERE state='reserved' ORDER BY lease_until LIMIT 1")).rows[0];
 const age=(value:Date|undefined)=>value?Math.max(0,Math.floor((time.getTime()-value.getTime())/1000)):0;
 signal?.throwIfAborted();
 await client.query('BEGIN');
 try{
  signal?.throwIfAborted();
  await client.query('INSERT INTO telemetry.observation_maintenance_state(id) VALUES(1) ON CONFLICT DO NOTHING');
  signal?.throwIfAborted();
  const state=(await client.query<ScanState>('SELECT health_device_cursor,health_capability_cursor,health_scan_started_at,health_enabled_count,health_stale_count FROM telemetry.observation_maintenance_state WHERE id=1 FOR UPDATE')).rows[0]!;
  signal?.throwIfAborted();
  const page=(await client.query<Capability>(`WITH page AS MATERIALIZED (
    SELECT device_id,capability_id,kind,enabled,interval_s,monitoring_started_at FROM telemetry.device_capabilities
    ${state.health_device_cursor?'WHERE (device_id,capability_id)>($2::uuid,$3::text)':''}
    ORDER BY device_id,capability_id LIMIT $1)
    SELECT c.*,d.revoked_at,p.last_capture_at,p.last_received_at FROM page c
    JOIN telemetry.devices d ON d.id=c.device_id
    LEFT JOIN telemetry.capability_presence p ON p.device_id=c.device_id AND p.capability_id=c.capability_id
    ORDER BY c.device_id,c.capability_id`,state.health_device_cursor?[limit+1,state.health_device_cursor,state.health_capability_cursor]:[limit+1])).rows;
  signal?.throwIfAborted();
  const processed=page.slice(0,limit);let enabled=state.health_enabled_count,stale=state.health_stale_count;
  for(const cap of processed){
   if(cap.kind!=='image'||!cap.enabled||cap.revoked_at)continue;
   enabled++;
   const threshold=(2*cap.interval_s+300)*1000;
   if(time.getTime()-cap.monitoring_started_at.getTime()<=threshold)continue;
   // Fresh arrival of old queued photos must not hide a stopped camera.
   if(!cap.last_capture_at||!cap.last_received_at||time.getTime()-cap.last_capture_at.getTime()>threshold||time.getTime()-cap.last_received_at.getTime()>threshold)stale++;
  }
  const complete=page.length<=limit,last=processed.at(-1),started=state.health_scan_started_at??time;
  await client.query('UPDATE telemetry.observation_maintenance_state SET health_device_cursor=$1,health_capability_cursor=$2,health_scan_started_at=$3,health_enabled_count=$4,health_stale_count=$5 WHERE id=1',[complete?null:last!.device_id,complete?null:last!.capability_id,complete?null:started,complete?0:enabled,complete?0:stale]);
  signal?.throwIfAborted();
  await client.query('COMMIT');
  return {deletion_backlog_lower_bound:backlog.length,deletion_backlog_capped:backlog.length>limit,deletion_oldest_age_s:age(backlog[0]?.queued_at),reservation_overdue_age_s:age(lease?.lease_until),camera_scan_complete:complete,camera_scan_age_s:age(started),...(complete?{camera_enabled_count:enabled,camera_stale_count:stale}:{})};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
