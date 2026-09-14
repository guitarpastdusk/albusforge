import { createTestDb as createDb, closeTestPool } from "./test-pool-shutdown";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { MemoryObservationStorage } from "@albusforge/storage/testing";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { buildApp } from "./app";
import { provisioningUser } from "./provisioning.test-fixtures";
let container: StartedPostgreSqlContainer, pool: pg.Pool;
const store = new MemoryObservationStorage();
let jpeg: Buffer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({"/var/lib/postgresql/data":"rw,size=256m"}).start();
  const config: DbConfig = { host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getPassword(), ssl: "disable" };
  await runMigrations(config, { appRole: { name: "observation_reader_test", password: "local-test-only" } });
  pool = createDb({ ...config, user: "observation_reader_test", password: "local-test-only" }).pool;
  jpeg = await readFile(new URL("./fixtures/observation-test.jpg", import.meta.url));
});
afterAll(async () => { await closeTestPool(pool); await container?.stop(); });
async function fixture() {
  const user = await provisioningUser(pool, "viewer"), device = randomUUID(), deviceToken = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES($1,$2,$3,'{}','{}')", [device,user.tenantId,createHash("sha256").update(deviceToken).digest("hex")]);
  for (const cap of ["camera.front","camera.rear"]) await pool.query(`INSERT INTO telemetry.device_capabilities(device_id,capability_id,kind,payload_schema,profile_id,profile_version,interval_s,max_bytes,max_width,max_height)
    VALUES($1,$2,'image','jpeg.v1','synthetic-camera',1,900,1048576,320,240)`, [device,cap]);
  const app = buildApp({parts:{latest:async()=>[]},ping:async()=>{},telemetryPool:pool,observationStorage:store,log:()=>{}});
  const root = `/v1/devices/${device}/capabilities`;
  const get = (path:string,cookie=user.cookie) => app.inject({url:path,headers:{cookie}});
  const insert = async (cap="camera.front", age=0) => {
    const id=randomUUID(),hash=createHash("sha256").update(jpeg).digest("hex"),key=`tenant/${user.tenantId}/device/${device}/${id}.jpg`;
    const object=await store.create(key,jpeg,{sha256:hash,fingerprint:hash});
    await pool.query(`INSERT INTO telemetry.observation_receipts(device_id,observation_id,capability_id,fingerprint,sha256,bytes,captured_at,received_at,expires_at,state,reserved_day)
      VALUES($1,$2,$3,$4,$4,$5,now()-make_interval(secs=>$6),now(),now()+interval '30 days'-make_interval(secs=>$6),'stored',to_char(now(),'YYYY-MM-DD'))`,[device,id,cap,hash,jpeg.length,age]);
    await pool.query("INSERT INTO telemetry.observation_images(device_id,observation_id,object_key,generation,width,height) VALUES($1,$2,$3,$4,320,240)",[device,id,key,object.generation]);
    return{id,key,cap,path:`${root}/${cap}/images/${id}/content`};
  };
  return{...user,device,deviceToken,app,root,get,insert};
}
it("shows empty camera state and returns private JPEGs with capability-scoped latest/history",async()=>{
  const f=await fixture();try{
    expect((await f.get(`${f.root}/camera.front/images/latest`)).json()).toEqual({image:null});
    const old=await f.insert("camera.front",60),fresh=await f.insert(),rear=await f.insert("camera.rear");
    const latest=await f.get(`${f.root}/camera.front/images/latest`);
    expect(latest.statusCode).toBe(200);expect(latest.json().image.observation_id).toBe(fresh.id);
    const first=(await f.get(`${f.root}/camera.front/images?limit=1`)).json();
    expect(first.images.map((r:{observation_id:string})=>r.observation_id)).toEqual([fresh.id]);
    const next=(await f.get(`${f.root}/camera.front/images?limit=1&cursor=${first.next_cursor}`)).json();expect(next.images[0].observation_id).toBe(old.id);
    expect((await f.get(`${f.root}/camera.rear/images?cursor=${first.next_cursor}`)).statusCode).toBe(400);
    expect((await f.get(rear.path.replace('camera.rear','camera.front'))).statusCode).toBe(404);
    const content=await f.get(fresh.path);expect(content.statusCode).toBe(200);expect(content.rawPayload).toEqual(jpeg);
    expect(content.headers['cache-control']).toBe('private, no-store');expect(content.headers['x-content-type-options']).toBe('nosniff');expect(content.headers['content-type']).toBe('image/jpeg');
    expect(latest.body).not.toContain('object_key');expect(latest.body).not.toContain(f.tenantId);
  }finally{await f.app.close();}
});
it("enforces current session/tenant membership, never device bearer access; revoked upload credentials retain user history",async()=>{
  const f=await fixture(),other=await fixture();try{
    const img=await f.insert();expect((await f.get(img.path,'')).statusCode).toBe(401);expect((await f.get(img.path,other.cookie)).statusCode).toBe(404);
    expect((await f.app.inject({url:img.path,headers:{authorization:`Bearer ${f.deviceToken}`}})).statusCode).toBe(401);
    await pool.query('UPDATE telemetry.devices SET revoked_at=now() WHERE id=$1',[f.device]);expect((await f.get(img.path)).statusCode).toBe(200);
    await pool.query('DELETE FROM users.tenant_members WHERE tenant_id=$1 AND user_id=$2',[f.tenantId,f.userId]);expect((await f.get(img.path)).statusCode).toBe(403);
  }finally{await f.app.close();await other.app.close();}
});
it("enforces expiry on reads before physical cleanup and handles missing objects",async()=>{
  const f=await fixture();try{
    const expired=await f.insert('camera.front',31*86400);expect((await f.get(expired.path)).statusCode).toBe(404);
    expect((await f.get(`${f.root}/camera.front/images`)).json().images).toEqual([]);
    const img=await f.insert();const object=await store.head(img.key);await store.delete(img.key,object!.generation);
    expect((await f.get(img.path)).statusCode).toBe(404);
  }finally{await f.app.close();}
});
it("rechecks session revocation after object I/O and isolates per-camera presence",async()=>{
  const f=await fixture();const read=store.read.bind(store);try{
    const img=await f.insert();store.read=async(...args)=>{const bytes=await read(...args);await pool.query('UPDATE users.sessions SET revoked_at=now() WHERE id=$1',[f.sessionId]);return bytes;};
    expect((await f.get(img.path)).statusCode).toBe(401);store.read=read;
    await pool.query('UPDATE users.sessions SET revoked_at=NULL WHERE id=$1',[f.sessionId]);
    await pool.query("INSERT INTO telemetry.capability_presence(device_id,capability_id,last_capture_at,last_received_at) VALUES($1,'camera.front',now(),now()),($1,'camera.rear',now()-interval '1 hour',now()-interval '1 hour')",[f.device]);
    const response=await f.get(f.root);expect(response.statusCode).toBe(200);
    expect(response.json().capabilities.map((c:{status:string})=>c.status)).toEqual(['healthy','stale']);
  }finally{store.read=read;await f.app.close();}
});
