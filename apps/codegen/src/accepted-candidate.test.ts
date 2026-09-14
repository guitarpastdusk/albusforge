import { expect,it } from 'vitest';
import { Spec } from '@albusforge/schema';
import { syntheticCameraPlanFixture, syntheticCameraApproval as cameraFixtureApproval } from './testing';
import { CAMERA_CANDIDATE, CAMERA_CHANNELS } from './camera-candidate';
import { cameraApprovalsFromEnv,resolveAcceptedCandidate,renderCandidate,editCandidate } from './accepted-candidate';
it('keeps camera compilation off without explicit exact approved evidence and wiring',()=>{
  const f=syntheticCameraPlanFixture(),approval=cameraFixtureApproval(f),spec=Spec.parse(f.spec);
  expect(cameraApprovalsFromEnv({})).toEqual([]);
  expect(()=>resolveAcceptedCandidate(f.plan,f.metadata,spec)).toThrow('approved camera');
  const candidate=resolveAcceptedCandidate(f.plan,f.metadata,spec,[approval]);
  expect(candidate).toMatchObject({id:CAMERA_CANDIDATE,kind:'camera',runtime:'0.3.0',interval_s:900,template:'esp32s3-camera',channels:CAMERA_CHANNELS});
  expect(renderCandidate(candidate,900)).toContain('hsx_camera_run');
  for(const seconds of [60,899,901,1800])expect(()=>renderCandidate(candidate,seconds)).toThrow();
  expect(editCandidate(candidate,'Set interval to 900 seconds')).toBe(900);
  expect(()=>editCandidate(candidate,'Set interval to 1800 seconds')).toThrow();
  expect(()=>resolveAcceptedCandidate(f.plan,f.metadata,spec,[approval,approval])).toThrow();
  for(const field of ['evidence_sha256','wiring_sha256'] as const)expect(()=>resolveAcceptedCandidate(f.plan,f.metadata,spec,[{...approval,[field]:'0'.repeat(64)}])).toThrow();
});
it('rejects drift, inactive evidence, compatibility failure and shortened/lengthened cadence despite supplied approval',()=>{
  for(const change of [
    (f:ReturnType<typeof syntheticCameraPlanFixture>)=>{f.metadata.evidence.parts[0]!.status='draft';},
    (f:ReturnType<typeof syntheticCameraPlanFixture>)=>{f.metadata.evidence.compat[0]!.status='failed';},
    (f:ReturnType<typeof syntheticCameraPlanFixture>)=>{f.spec.sense.interval_s=1800;},
    (f:ReturnType<typeof syntheticCameraPlanFixture>)=>{f.plan.runtime='0.1.0';},
  ]) {const f=syntheticCameraPlanFixture();change(f);expect(()=>resolveAcceptedCandidate(f.plan,f.metadata,Spec.parse(f.spec),[cameraFixtureApproval(f)])).toThrow();}
});
it('rejects malformed, duplicate or runtime/template configurable approval settings',()=>{
  const f=syntheticCameraPlanFixture(),a=cameraFixtureApproval(f);
  for(const value of ['invalid',JSON.stringify([a,a]),JSON.stringify([{...a,template:'/tmp/arbitrary'}])])expect(()=>cameraApprovalsFromEnv({CAMERA_PLAN_APPROVALS:value})).toThrow();
});
