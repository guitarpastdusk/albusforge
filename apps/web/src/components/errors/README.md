# src/components/errors/

`ServiceUnavailable` — what the error boundaries (`app/error.tsx`, `app/global-error.tsx`) render when a page can't: a "Service unavailable" kicker, a title, one muted line, a coral **Try again** that calls the boundary's `retry()`, and "Reference: <digest>" when Next.js provides one. The digest matches the server log entry for the failure; the error message itself is never shown. Render tests in `errors.test.tsx`.
