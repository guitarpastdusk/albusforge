/**
 * What every Server Function in src/actions returns. Failures are values, not
 * throws: a thrown error would replace the page with the error boundary, and
 * a failed send should only show a message where it happened.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };
