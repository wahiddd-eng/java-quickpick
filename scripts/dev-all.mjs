// Starts the API and the three web apps together with labelled output. Ctrl+C stops all.
import { spawn } from 'node:child_process';

const procs = [
  ['api    ', 'dev:api', '\x1b[35m'],
  ['student', 'dev:student', '\x1b[32m'],
  ['vendor ', 'dev:vendor', '\x1b[36m'],
  ['admin  ', 'dev:admin', '\x1b[33m'],
];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = procs.map(([label, script, color]) => {
  const child = spawn(npm, ['run', '--silent', script], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const out = (buf) => buf.toString().split('\n').filter(Boolean).forEach((l) => console.log(`${color}[${label}]\x1b[0m ${l}`));
  child.stdout.on('data', out);
  child.stderr.on('data', out);
  child.on('exit', (code) => console.log(`${color}[${label}]\x1b[0m exited (${code})`));
  return child;
});
console.log('\n  Student  http://localhost:5173\n  Vendor   http://localhost:5174\n  Admin    http://localhost:5175\n  API      http://localhost:4000\n');
const stop = () => { children.forEach((c) => c.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
