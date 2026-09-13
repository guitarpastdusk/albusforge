-- CI-only public fixture. Never provision this credential outside an isolated test DB.
INSERT INTO users.tenants(id,name) VALUES('11111111-1111-4111-8111-111111111111','Container smoke test');
INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source) VALUES (
 '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
 encode(sha256(convert_to(repeat('A',43),'UTF8')),'hex'),
 '{"temperature_c":{"unit":"C","min":-40,"max":85}}', '{"kind":"ci"}'
);
