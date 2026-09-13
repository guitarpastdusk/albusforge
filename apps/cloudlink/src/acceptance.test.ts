import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';

describe('deployment acceptance preparation', () => {
  it('exports only hashes for remote SQL and scopes cleanup without deleting accounting', () => {
    const dir=mkdtempSync(join(tmpdir(),'sensor-acceptance-'));
    try {
      const file=join(dir,'fixture.json'), sql=join(dir,'provision.json'), cleanup=join(dir,'cleanup.json');
      const run=(phase:string,output:string,environment='staging')=>spawnSync('pnpm',['exec','tsx',resolve('scripts/acceptance.ts'),phase,file,environment],{encoding:'utf8',env:{...process.env,ACCEPTANCE_SQL_EXPORT:output}});
      const prepared=run('provision',sql); expect(prepared.status).toBe(0); expect(prepared.stdout).toContain('prepared_not_executed');
      const f=JSON.parse(readFileSync(file,'utf8')); const text=readFileSync(sql,'utf8');
      expect(statSync(file).mode&0o777).toBe(0o600); expect(statSync(sql).mode&0o777).toBe(0o600);
      for(const token of [f.token,f.session,f.otherSession]) { expect(text).not.toContain(token); expect(prepared.stdout).not.toContain(token); expect(text).toContain(createHash('sha256').update(token).digest('hex')); }
      const statements=JSON.parse(text).statements; expect(statements[0].text).toBe('BEGIN'); expect(statements.at(-1).text).toBe('COMMIT');
      expect(run('cleanup',cleanup,'prod').status).toBe(1);
      expect(run('cleanup',cleanup).status).toBe(0);
      const clean=readFileSync(cleanup,'utf8'); expect(clean).not.toContain('DELETE'); expect(clean).toContain('acceptance_run'); expect(clean).toContain(f.run);
      // Never overwrite credentials on retry; uncertain writes remain recoverable.
      expect(run('provision',sql).status).toBe(1); expect(JSON.parse(readFileSync(file,'utf8')).run).toBe(f.run);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
});
