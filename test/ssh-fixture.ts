import {promises as fs} from 'node:fs';
import path from 'node:path';
// Execute the production SSH payload locally for deterministic browser tests.
// Only fixture hosts are intercepted; real hosts still use the system SSH client.
export async function sshFixture(root:string){
  const bin=path.join(root,'ssh-bin');await fs.mkdir(bin,{recursive:true});
  const script=`#!/usr/bin/env python3
import sys,os,subprocess
host=sys.argv[-2]
if host.endswith('.diff-studio.invalid'):
 if host=='offline.diff-studio.invalid':
  sys.stderr.write('Fixture host is offline');sys.exit(255)
 env=dict(os.environ);env['HOME']=${JSON.stringify(root)}
 sys.exit(subprocess.call(['/bin/sh','-c',sys.argv[-1]],env=env))
os.execv('/usr/bin/ssh',['ssh']+sys.argv[1:])
`;
  await fs.writeFile(path.join(bin,'ssh'),script,{mode:0o700});return bin;
}
