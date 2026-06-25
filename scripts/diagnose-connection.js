#!/usr/bin/env node
// Diagnoses LuxConnect <-> mapp Connect <-> OPC UA connectivity problems.
//
// Runs two kinds of checks:
//   1. Live probes against a running target (local ARsim or a real PLC) — is
//      mapp Connect listening, does its REST API answer, is the OPC UA server up.
//   2. Optional static scan of an AS project (`--project <path>`) — are the
//      config files set up the way LuxConnect needs (OPC UA enabled, the
//      /api/1.0/* endpoint allowed, SSL configs referenced, variables exposed).
//
// Each finding points at the matching step in README.md
// ("Configuring the Automation Studio Project"). Zero dependencies — Node stdlib only.
//
// Usage:
//   node scripts/diagnose-connection.js [options]
//   npm run diagnose -- --host 192.168.1.100 --project ../MyAsProject
//
// Options:
//   --host <h>         Target host (default 127.0.0.1)
//   --port <n>         mapp Connect SSL port (default 8443)
//   --opcua-port <n>   OPC UA C/S port (default 4840)
//   --protocol <p>     http | https (default https)
//   --user <u>         Username for an authenticated /auth probe (optional)
//   --pass <p>         Password for the authenticated probe (optional)
//   --project <path>   AS project root to statically scan (optional)
//   --help             Show this help
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}
if (argv.includes('--help')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n')
    .filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
const HOST = arg('host', '127.0.0.1');
const PORT = Number(arg('port', '8443'));
const OPCUA_PORT = Number(arg('opcua-port', '4840'));
const PROTOCOL = arg('protocol', 'https');
const USER = arg('user', '');
const PASS = arg('pass', '');
const PROJECT = arg('project', '');

// ---- reporting ------------------------------------------------------------
const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' };
let failures = 0;
let warnings = 0;
function pass(msg, detail) { console.log(`  ${C.green}PASS${C.reset} ${msg}${detail ? `  ${C.dim}${detail}${C.reset}` : ''}`); }
function fail(msg, hint) { failures++; console.log(`  ${C.red}FAIL${C.reset} ${msg}`); if (hint) console.log(`       ${C.dim}→ ${hint}${C.reset}`); }
function warn(msg, hint) { warnings++; console.log(`  ${C.yellow}WARN${C.reset} ${msg}`); if (hint) console.log(`       ${C.dim}→ ${hint}${C.reset}`); }
function info(msg) { console.log(`  ${C.dim}····${C.reset} ${msg}`); }
function header(msg) { console.log(`\n${C.bold}${msg}${C.reset}`); }

// ---- helpers --------------------------------------------------------------
function checkPort(host, port, useTls) {
  return new Promise((resolve) => {
    const socket = (useTls ? tlsConnect : netConnect)(
      useTls ? { host, port, rejectUnauthorized: false, timeout: 4000 } : { host, port, timeout: 4000 },
    );
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.on(useTls ? 'secureConnect' : 'connect', () => done({ ok: true }));
    socket.on('timeout', () => done({ ok: false, code: 'TIMEOUT' }));
    socket.on('error', (err) => done({ ok: false, code: err.code || 'ERROR', message: err.message }));
  });
}

function httpGet(path, auth) {
  return new Promise((resolve) => {
    const opts = { host: HOST, port: PORT, path, method: 'GET', rejectUnauthorized: false, timeout: 6000, headers: {} };
    if (auth) opts.headers.Authorization = `Basic ${Buffer.from(auth).toString('base64')}`;
    const req = (PROTOCOL === 'https' ? httpsRequest : httpRequest)(opts, (res) => {
      res.on('data', () => {}); // drain
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'TIMEOUT' }); });
    req.on('error', (err) => resolve({ error: err.code || err.message }));
    req.end();
  });
}

// ---- live probes ----------------------------------------------------------
async function liveProbes() {
  header(`Live probes — ${PROTOCOL}://${HOST}:${PORT} (mapp Connect), ${HOST}:${OPCUA_PORT} (OPC UA)`);

  // 1. mapp Connect port
  const mc = await checkPort(HOST, PORT, PROTOCOL === 'https');
  if (mc.ok) {
    pass(`mapp Connect port ${PORT} is listening`);
  } else {
    fail(`mapp Connect port ${PORT} not reachable (${mc.code})`,
      mc.code === 'ECONNREFUSED'
        ? 'Nothing is serving 8443. Deploy a config with mapp Connect (README step 2) and confirm RUN mode.'
        : 'Check host/port, firewall, and that the target is up.');
    return; // no point probing the API if the port is dead
  }

  // 2. REST API reachability + endpoint authorization (the 403 gotcha)
  const probe = await httpGet('/api/1.0/auth');
  if (probe.error) {
    fail(`GET /api/1.0/auth failed (${probe.error})`,
      String(probe.error).toUpperCase().includes('CERT')
        ? 'TLS/certificate problem — check the SSL config + certificate (README step 5).'
        : 'Could not complete the request; see error above.');
  } else if ([200, 401, 405].includes(probe.status)) {
    pass(`REST API reachable and authorized`, `GET /api/1.0/auth → ${probe.status}`);
  } else if (probe.status === 403) {
    fail(`REST API returns 403 Forbidden (GET /api/1.0/auth)`,
      'The /api/1.0/* endpoint is not allowed. Add a WebServerEndpointConfiguration entry for ' +
      '"/api/1.0/*" with an empty <Roles/> in Config.mappconnect (README step 3). ' +
      'LuxConnect\'s reachability probe rejects 403, so login never starts.');
  } else {
    warn(`GET /api/1.0/auth → unexpected status ${probe.status}`, 'Expected 200, 401, or 405.');
  }

  // 3. Optional authenticated probe
  if (USER) {
    const authed = await httpGet('/api/1.0/auth', `${USER}:${PASS}`);
    if (authed.error) warn(`Authenticated probe failed (${authed.error})`);
    else if (authed.status === 200) pass(`Authentication succeeded for "${USER}"`, `→ ${authed.status}`);
    else if (authed.status === 401) fail(`Authentication rejected for "${USER}" (401)`, 'Check username/password and that the user exists (README step 6).');
    else if (authed.status === 403) fail(`Authenticated request forbidden for "${USER}" (403)`, 'Endpoint authorization (step 3) or role permissions (step 6).');
    else warn(`Authenticated probe → status ${authed.status}`);
  } else {
    info('Skipping authenticated probe (no --user given)');
  }

  // 4. OPC UA C/S port
  const ua = await checkPort(HOST, OPCUA_PORT, false);
  if (ua.ok) {
    pass(`OPC UA C/S port ${OPCUA_PORT} is listening`);
  } else {
    fail(`OPC UA C/S port ${OPCUA_PORT} not reachable (${ua.code})`,
      'The OPC UA server is likely disabled. Set OpcUaCs=1 in UaCsConfig.uacfg (README step 1). ' +
      'Without it mapp Connect connects but no variable ever updates.');
  }
}

// ---- static config scan ---------------------------------------------------
function findFiles(root, predicate, acc = []) {
  let entries;
  try { entries = readdirSync(root); } catch { return acc; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'Temp' || name === 'Binaries' || name === '.git') continue;
    const full = join(root, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) findFiles(full, predicate, acc);
    else if (predicate(name)) acc.push(full);
  }
  return acc;
}
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

function scanProject(root) {
  header(`Static config scan — ${root}`);
  if (!existsSync(root)) { fail(`Project path does not exist: ${root}`); return; }

  // OPC UA C/S server enabled?
  for (const f of findFiles(root, (n) => n.endsWith('.uacfg'))) {
    const xml = read(f);
    const enabled = /OpcUaCs"\s+Value="1"/.test(xml);
    const certRef = (xml.match(/AppCertificateStoreConfiguration"\s+Value="([^"]*)"/) || [])[1];
    const port = (xml.match(/TcpPort"\s+Value="([^"]*)"/) || [])[1];
    info(`UaCsConfig: ${basename(f)}`);
    enabled ? pass('OPC UA C/S server enabled (OpcUaCs=1)') : fail('OPC UA C/S server disabled (OpcUaCs=0)', 'Set OpcUaCs=1 (README step 1).');
    certRef ? pass(`OPC UA SSL config referenced`, `AppCertificateStoreConfiguration="${certRef}"`) : warn('No AppCertificateStoreConfiguration set', 'Reference an OpcUaServerSslCfg (README step 5).');
    if (port) info(`OPC UA TcpPort = ${port}`);
  }

  // mapp Connect config
  const mcFiles = findFiles(root, (n) => n.endsWith('.mappconnect'));
  if (!mcFiles.length) fail('No Config.mappconnect found', 'Add a mapp Connect configuration and register it in Cpu.pkg (README step 2).');
  for (const f of mcFiles) {
    const xml = read(f);
    info(`mapp Connect: ${basename(f)}`);
    const apiAllowed = /Endpoint"\s+Value="\/api\/1\.0\/\*"/.test(xml);
    apiAllowed
      ? pass('REST API endpoint allowed (/api/1.0/*)')
      : fail('Missing WebServerEndpointConfiguration for /api/1.0/*', 'Without it mapp Connect returns 403 to every request (README step 3).');
    const sslRef = (xml.match(/SSLConfiguration"\s+Value="([^"]*)"/) || [])[1];
    sslRef ? pass('HTTPS SSL config referenced', `SSLConfiguration="${sslRef}"`) : warn('No SSLConfiguration reference', 'Reference a CommonSslCfg (README step 5).');
    const wl = (xml.match(/Url"\s+Value="(opc\.tcp:\/\/[^"]*)"/) || [])[1];
    wl ? pass('OPC UA server whitelisted', wl) : warn('No OpcUaServerWhitelist URL', 'Point it at the local OPC UA server (README step 2).');

    // cross-check the SSL reference resolves
    if (sslRef) {
      const sslDefined = findFiles(root, (n) => n.endsWith('.sslcfg'))
        .some((s) => new RegExp(`Element ID="${sslRef}"`).test(read(s)));
      sslDefined ? pass(`SSL config "${sslRef}" is defined`) : fail(`SSL config "${sslRef}" referenced but not defined`, 'Define it in a .sslcfg under AccessAndSecurity/TransportLayerSecurity (README step 5).');
    }
  }

  // mappConnect registered in Cpu.pkg?
  const cpuPkgs = findFiles(root, (n) => n === 'Cpu.pkg');
  const registered = cpuPkgs.some((f) => /<Object Type="Package">mappConnect<\/Object>/.test(read(f)));
  if (cpuPkgs.length) {
    registered ? pass('mappConnect package registered in Cpu.pkg') : fail('mappConnect not registered in Cpu.pkg', 'Add <Object Type="Package">mappConnect</Object> (README step 2).');
  }

  // SSL configs have a certificate linked
  for (const f of findFiles(root, (n) => n.endsWith('.sslcfg'))) {
    const xml = read(f);
    const hasCert = /OwnCertificate"\s+Value="[^"]+"/.test(xml);
    info(`SSL config: ${basename(f)}`);
    hasCert ? pass('Certificate linked (OwnCertificate set)') : fail('No OwnCertificate in SSL config', 'Create a cert under CertificateStore/OwnCertificates and link it (README step 5).');
  }
}

// ---- run ------------------------------------------------------------------
console.log(`${C.bold}LuxConnect connection diagnostics${C.reset}`);
if (PROJECT) await scanProject(PROJECT);
await liveProbes();

header('Summary');
if (failures === 0 && warnings === 0) {
  console.log(`  ${C.green}All checks passed.${C.reset}`);
} else {
  console.log(`  ${failures} failure(s), ${warnings} warning(s).`);
  console.log(`  ${C.dim}See README.md → "Configuring the Automation Studio Project" for fixes.${C.reset}`);
}
process.exit(failures > 0 ? 1 : 0);
