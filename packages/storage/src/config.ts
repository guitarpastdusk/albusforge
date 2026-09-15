import { accessSync, constants, statSync } from 'node:fs';
import { GcsObservationStorage } from './isolated.js';
/** Runtime activation is explicit; missing resources never fall back to a fake store. */
export function observationStorageFromEnv(env: Readonly<Record<string, string | undefined>>, flag: 'OBSERVATION_UPLOADS_ENABLED' | 'OBSERVATION_READS_ENABLED') {
  const enabled = env[flag] ?? '0';
  if (!['0','1'].includes(enabled)) throw new Error(`Invalid ${flag}`);
  if (enabled === '0') return undefined;
  if (!env.CAMERA_IMAGES_BUCKET) throw new Error('CAMERA_IMAGES_BUCKET required for observations');
  const workerPath = env.OBSERVATION_STORAGE_WORKER_PATH;
  try {
    if (!workerPath || !statSync(workerPath).isFile()) throw new Error('Invalid worker');
    accessSync(workerPath, constants.R_OK);
  } catch { throw new Error('OBSERVATION_STORAGE_WORKER_PATH must identify a readable built storage worker'); }
  return new GcsObservationStorage({ bucket: env.CAMERA_IMAGES_BUCKET, workerPath });
}
