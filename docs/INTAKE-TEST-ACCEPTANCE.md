# Intake deadline test acceptance

The intake handler database suite uses PostgreSQL 16, migrated application-role connections and fixture model responses. Production handler, PostgreSQL pool settings and caller deadlines are unchanged by the test scheduling correction.

Two CI failures did not establish the intended test schedules:

- `cleanup rejection handling` allowed only 300ms for real database setup plus the model and 380ms for the response. On a busy runner the response budget could expire before the provider enabled the injected query failures, making `lateQueries` empty. The test now freezes JavaScript Date/timers during setup, waits for the first injected metering query, then advances the fault/cleanup timers. It still requires observed failed queries, logged failure and exactly one gateway retry, with all cleanup rejections observed.
- `deadline inside metering` released the build-row blocker after a JavaScript 650ms timer while PostgreSQL independently cancelled statements after 500ms. If the runner delayed the release, the fallback message's build foreign key could also time out waiting for that row. The test now waits for the actual metering lock query before advancing the 250ms model deadline. PostgreSQL's 500ms cancellation remains real. The intercepted cancellation releases the blocker before returning its rejection to the handler, establishing cancellation → cleanup/rollback → fallback write explicitly.

The metering case must observe one SQLSTATE `57014`, exactly one fallback message, zero committed usage rows and the expected build status. Neither test weakens the assertions into allowing a missed phase or a retry where a successful fallback is required. The separate real-clock `a connection lost after the model answers` scheduler test still checks that intake returns a retryable 503 before the 1,500ms caller deadline, destroys the connection, preserves usage atomicity and permits a subsequent successful turn. Production budgets are not increased.

Local acceptance runs the two affected schedules against real PostgreSQL, then the complete intake suite, typecheck, lint and service bundle build. Fixtures do not call a live model or deploy infrastructure.
