import { spawn } from 'node:child_process';

let stage = 'credential';
try {
  const credential = await new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, windowsHide: true });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('GITHUB_LOGIN_REQUIRED')));
    child.stdin.end('protocol=https\nhost=github.com\npath=nodAbon/hecto-attendance.git\n\n');
  });
  const token = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw new Error('GITHUB_LOGIN_REQUIRED');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  stage = 'metadata';
  const read = async endpoint => {
    const result = await fetch(`https://api.github.com${endpoint}`, { headers });
    return { status: result.status, data: await result.json() };
  };
  const user = await read('/user');
  const source = await read('/repos/nodAbon/hecto-attendance');
  const destinationUser = await read('/users/BuhoKim');
  const destinationRepo = await read('/repos/BuhoKim/hecto-attendance');
  if (process.argv.includes('--transfer')) {
    if (source.status !== 200 || !source.data.permissions?.admin || destinationUser.status !== 200
      || destinationRepo.status !== 404) throw new Error('TRANSFER_PREFLIGHT_FAILED');
    stage = 'transfer';
    const transfer = await fetch('https://api.github.com/repos/nodAbon/hecto-attendance/transfer', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_owner: 'BuhoKim' }) });
    if (transfer.status !== 202) {
      console.error(JSON.stringify({ stage, status: transfer.status, code: 'TRANSFER_NOT_ACCEPTED' }));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ status: 'transfer-requested', from: 'nodAbon/hecto-attendance',
        to: 'BuhoKim/hecto-attendance', receiverAcceptanceRequired: true, visibilityChanged: false,
        localRemoteChanged: false }));
    }
    process.exit();
  }
  console.log(JSON.stringify({ connectedUser: user.status === 200 ? user.data.login : null,
    sourceStatus: source.status, sourceRepo: source.data.full_name, private: source.data.private,
    sourceAdmin: source.data.permissions?.admin === true, defaultBranch: source.data.default_branch,
    destinationAccountStatus: destinationUser.status, destinationAccountType: destinationUser.data.type,
    destinationRepoStatus: destinationRepo.status,
    note: '404 does not prove absence of a private repository without destination-account authorization. No transfer executed.' }));
} catch (error) {
  console.error(JSON.stringify({ stage, code: /^[A-Z_]+$/.test(error.message || '') ? error.message : 'GITHUB_CHECK_FAILED' }));
  process.exitCode = 1;
}
