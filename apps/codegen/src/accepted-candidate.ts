import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BuildPlanMetadata, BuildPlanV1, type Spec, type FirmwareManifest } from '@albusforge/schema';
import { NUMERIC_CANDIDATES, selectNumericCandidate, renderApp, editInterval, type NumericSelection } from './candidate';
import { CAMERA_CANDIDATE, CAMERA_RUNTIME, CAMERA_CHANNELS, CAMERA_CAPABILITIES, renderCameraApp } from './camera-candidate';
const Pin=z.strictObject({id:z.string().min(1).max(120),version:z.string().min(1).max(40)});
const Digest=z.string().regex(/^[a-f0-9]{64}$/);
/** Server-owned physical approval. No approved entries ship with this source.
 * Digests pin complete registry/compat/connector evidence and physical wiring,
 * not merely mutable labels. Template/runtime/capabilities are never configurable. */
export const CameraPlanApproval=z.strictObject({
  candidate_id:z.literal(CAMERA_CANDIDATE), assembly_profile:Pin,
  part_versions:z.array(Pin).min(1).max(64), evidence_sha256:Digest, wiring_sha256:Digest,
}).refine(a=>new Set(a.part_versions.map(p=>`${p.id}@${p.version}`)).size===a.part_versions.length,'Duplicate approval parts');
export type CameraPlanApproval=z.infer<typeof CameraPlanApproval>;
export function canonicalDigest(value:unknown):string {
  const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sort(x)])):v;
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}
export function cameraApprovalsFromEnv(env:Readonly<Record<string,string|undefined>>):CameraPlanApproval[] {
  const raw=env.CAMERA_PLAN_APPROVALS;
  if(raw&&raw.length>65536)throw Error('Camera approval configuration too large');
  const values=z.array(CameraPlanApproval).max(32).parse(JSON.parse(raw??'[]'));
  if(new Set(values.map(v=>`${v.assembly_profile.id}@${v.assembly_profile.version}`)).size!==values.length)throw Error('Ambiguous camera plan approvals');
  return values;
}
export interface AcceptedCandidate {
  id:string; kind:'numeric'|'camera'; runtime:string; interval_s:number;
  template:'esp32s3'|'esp32s3-camera';
  channels:FirmwareManifest['channels']; capabilities:FirmwareManifest['capabilities'];
  /** Board wiring and sensor set the numeric compiler builds for. */
  numeric?:NumericSelection;
}
const pins=(values:readonly {id:string;version:string}[])=>values.map(v=>`${v.id}@${v.version}`).sort().join('|');
export function resolveAcceptedCandidate(plan:BuildPlanV1,metadata:BuildPlanMetadata,spec:Spec,approvals:readonly CameraPlanApproval[]=[]):AcceptedCandidate {
  if(NUMERIC_CANDIDATES.some(c=>c.id===plan.profile.id)) {
    const numeric=selectNumericCandidate(plan,metadata,spec);
    return {id:numeric.candidate.id,kind:'numeric',runtime:numeric.candidate.runtime,interval_s:numeric.interval_s,template:'esp32s3',channels:numeric.channels,capabilities:undefined,numeric};
  }
  const evidence=metadata.evidence;
  const matches=approvals.map(a=>CameraPlanApproval.parse(a)).filter(a=>a.assembly_profile.id===plan.profile.id&&a.assembly_profile.version===plan.profile.version&&pins(a.part_versions)===pins(plan.part_versions));
  const approval=matches[0];
  if(matches.length!==1||!approval||metadata.runtime!==CAMERA_RUNTIME||plan.runtime!==CAMERA_RUNTIME
    ||metadata.profile.id!==plan.profile.id||metadata.profile.version!==plan.profile.version
    ||evidence.profile.id!==plan.profile.id||evidence.profile.version!==plan.profile.version
    ||pins(evidence.parts)!==pins(plan.part_versions)||evidence.parts.some(p=>p.status!=='active')
    ||canonicalDigest(evidence)!==approval.evidence_sha256||canonicalDigest(plan.wiring_graph)!==approval.wiring_sha256
    ||pins([evidence.profile.brain,evidence.profile.source])!==pins([plan.wiring_graph.brain,plan.wiring_graph.source])
    ||evidence.profile.brain.id!==plan.wiring_graph.brain.id||evidence.profile.source.id!==plan.wiring_graph.source.id
    ||evidence.parts.some(p=>p.software.driver_pkg!==null&&!evidence.compat.some(c=>c.status==='passed'&&c.brain_id===plan.wiring_graph.brain.id&&c.driver_pkg===p.software.driver_pkg&&c.driver_ver===p.software.driver_version&&c.runtime_ver===CAMERA_RUNTIME))
    ||spec.connect.transport!=='wifi'||spec.power.source!=='usb'||spec.sense.interval_s!==900)throw Error('This accepted plan has no approved camera compiler profile');
  return {id:CAMERA_CANDIDATE,kind:'camera',runtime:CAMERA_RUNTIME,interval_s:900,template:'esp32s3-camera',channels:CAMERA_CHANNELS,capabilities:CAMERA_CAPABILITIES};
}
export function renderCandidate(candidate:AcceptedCandidate,interval:number):string {
  return candidate.kind==='camera'?renderCameraApp(interval):renderApp(interval);
}
export function editCandidate(candidate:AcceptedCandidate,instruction:string):number {
  const interval=editInterval(instruction);renderCandidate(candidate,interval);return interval;
}
export function candidateManifestMatches(candidate:AcceptedCandidate,manifest:FirmwareManifest):boolean {
  return manifest.profile_id===candidate.id&&manifest.runtime===candidate.runtime&&canonicalDigest(manifest.channels)===canonicalDigest(candidate.channels)
    &&canonicalDigest(manifest.capabilities??[])===canonicalDigest(candidate.capabilities??[]);
}
