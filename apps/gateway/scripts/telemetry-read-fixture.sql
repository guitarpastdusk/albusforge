-- Disposable CI database only. The known session token is 43 'A' characters.
INSERT INTO users.tenants(id,name) VALUES('00000000-0000-4000-8000-000000000001','Read API smoke');
INSERT INTO users.users(id,email) VALUES('00000000-0000-4000-8000-000000000002','read-smoke@example.test');
INSERT INTO users.tenant_members(tenant_id,user_id,role)
VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','viewer');
INSERT INTO users.sessions(token_hash,user_id,active_tenant_id,expires_at)
VALUES(encode(sha256(convert_to(repeat('A',43),'UTF8')),'hex'),
  '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',now()+interval '1 hour');
INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source)
VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','ci-device-hash',
  '{"temperature_c":{"unit":"C","min":-40,"max":85}}','{"kind":"ci"}');
