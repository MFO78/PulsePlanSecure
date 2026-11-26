#!/usr/bin/env node
/**
 * Automated AES-256-GCM + PBKDF2-SHA-256 cryptography test suite for PulsePlanSecure.
 * Verifies round-trip encryption/decryption, wrong-passphrase rejection, and tamper detection.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'src', 'js', '13-security-licence.js'), 'utf8');
const loadModule = new Function(`
  ${src}
  return {
    encryptPulsePlanData,
    decryptPulsePlanData,
    ppWrapMasterPassphrase,
    ppUnwrapMasterPassphrase,
    ppDecryptWithUserCredentials,
  };
`);
const {
  encryptPulsePlanData,
  decryptPulsePlanData,
  ppWrapMasterPassphrase,
  ppUnwrapMasterPassphrase,
  ppDecryptWithUserCredentials,
} = loadModule();

const sampleDb = {
  meta: { version: 3, revision: 42 },
  departments: [{ id: 'd_eng', name: 'Engineering', defaultCapacity: 8 }],
  projects: [{ id: 'p_nova', name: 'Project Nova', code: 'NVA' }],
  allocations: { 'd_eng::p_nova::2026-W47': 2.5 },
};

// 1. Round-trip encrypt & decrypt
const envelope = await encryptPulsePlanData(sampleDb, 'CorrectHorseBatteryStaple!');
assert.equal(envelope.format, 'pulseplan-encrypted-v1');
assert.equal(envelope.cipher, 'AES-256-GCM');
assert.equal(envelope.iterations, 250000);
assert.equal(envelope.auth, undefined, 'No outer auth block when no users exist');
assert.ok(!envelope.ciphertext.includes('Engineering'), 'Plaintext must not leak into ciphertext');

const plainJson = await decryptPulsePlanData(envelope, 'CorrectHorseBatteryStaple!');
assert.deepEqual(JSON.parse(plainJson), sampleDb, 'Decrypted DB must match original');

// 2. Wrong passphrase must reject
await assert.rejects(
  () => decryptPulsePlanData(envelope, 'WrongPassphrase123!'),
  /Decryption failed/,
  'Wrong passphrase must fail AES-GCM authentication'
);

// 3. Tampered ciphertext must reject
const tampered = { ...envelope, ciphertext: 'AAAA' + envelope.ciphertext.slice(4) };
await assert.rejects(
  () => decryptPulsePlanData(tampered, 'CorrectHorseBatteryStaple!'),
  /Decryption failed/,
  'Tampered ciphertext must fail AES-GCM authentication'
);

// 4. Short passphrase must reject
await assert.rejects(
  () => encryptPulsePlanData(sampleDb, 'short'),
  /at least 8 characters/,
  'Passphrases under 8 characters must be rejected'
);

// 5. Multi-user key wrapping: user password internally unlocks Admin password to decrypt DB
const adminPass = 'AdminMasterPass#2026';
const userTempPass = 'TempUserPw#11';
const userPersonalPass = 'ElenaSecretPass#99';
const slot = await ppWrapMasterPassphrase(adminPass, userTempPass, 'u_elena');
const unwrapped = await ppUnwrapMasterPassphrase(slot, userTempPass, 'u_elena');
assert.equal(unwrapped, adminPass, 'User password must unwrap exact Administrator master passphrase internally');

await assert.rejects(
  () => ppUnwrapMasterPassphrase(slot, 'WrongUserPw#99', 'u_elena'),
  /Incorrect password/,
  'Wrong user password must reject key unwrap'
);

const multiUserDb = {
  ...sampleDb,
  accessControl: {
    version: 1,
    adminName: 'Lead Admin',
    users: [
      {
        id: 'u_elena',
        name: 'Elena Rostova',
        roleTitle: 'Technical Lead',
        enabled: true,
        mustChangePassword: true,
        permissions: { tabs: { matrix: true, health: true, data: false, sync: false }, finance: false },
        keySlot: slot,
      },
    ],
  },
};

const multiEnv = await encryptPulsePlanData(multiUserDb, adminPass);
assert.ok(multiEnv.auth && multiEnv.auth.users.length === 1, 'Outer envelope projects active user login metadata');
assert.equal(multiEnv.auth.adminName, 'Lead Admin');
assert.ok(!JSON.stringify(multiEnv.auth).includes(adminPass), 'Administrator passphrase must NEVER appear in plaintext outer auth');

// User decrypts main DB via their own password -> masterPass unwrapped internally
const userLoginRes = await ppDecryptWithUserCredentials(multiEnv, 'u_elena', userTempPass);
assert.equal(userLoginRes.authRole, 'user');
assert.equal(userLoginRes.masterPass, adminPass);
assert.equal(userLoginRes.userRecord.permissions.finance, false);
assert.equal(JSON.parse(userLoginRes.plainJson).projects[0].code, 'NVA');

// Admin still decrypts directly with Admin password
const adminLoginRes = await ppDecryptWithUserCredentials(multiEnv, '__ADMIN__', adminPass);
assert.equal(adminLoginRes.authRole, 'admin');
assert.equal(adminLoginRes.masterPass, adminPass);

// 6. User selects personal password -> re-wraps same Admin key; old temp password no longer works
const newSlot = await ppWrapMasterPassphrase(userLoginRes.masterPass, userPersonalPass, 'u_elena');
multiUserDb.accessControl.users[0].keySlot = newSlot;
multiUserDb.accessControl.users[0].mustChangePassword = false;
const reEnv = await encryptPulsePlanData(multiUserDb, userLoginRes.masterPass);
await assert.rejects(
  () => ppDecryptWithUserCredentials(reEnv, 'u_elena', userTempPass),
  /Incorrect password/,
  'Old temporary password must fail after user sets personal password'
);
const personalLoginRes = await ppDecryptWithUserCredentials(reEnv, 'u_elena', userPersonalPass);
assert.equal(personalLoginRes.masterPass, adminPass);
assert.equal(personalLoginRes.userRecord.mustChangePassword, false);

// 7. Disabled user inside authenticated ciphertext must be rejected even if outer auth tampered
const disabledDb = JSON.parse(JSON.stringify(multiUserDb));
disabledDb.accessControl.users[0].enabled = false;
const disabledEnv = await encryptPulsePlanData(disabledDb, adminPass);
assert.equal(disabledEnv.auth, undefined, 'Disabled user is excluded from outer auth');
disabledEnv.auth = reEnv.auth; // Simulate attacker re-attaching old outer auth
await assert.rejects(
  () => ppDecryptWithUserCredentials(disabledEnv, 'u_elena', userPersonalPass),
  /disabled or removed/,
  'Authenticated ciphertext must reject disabled user even with forged outer auth'
);

// 8. Delegated Admin (isAdmin) preserved in outer auth & decrypted DB, plus Main Admin password rotation
const delegatedAdminSlot = await ppWrapMasterPassphrase(adminPass, 'PriyaAdmin#88', 'u_priya');
const delegatedDb = JSON.parse(JSON.stringify(multiUserDb));
delegatedDb.accessControl.users.push({
  id: 'u_priya',
  name: 'Priya Nair',
  roleTitle: 'Engineering Director',
  enabled: true,
  isAdmin: true,
  mustChangePassword: false,
  permissions: { tabs: { matrix: true, health: true, data: true, sync: true }, finance: true },
  keySlot: delegatedAdminSlot,
});
const delEnv = await encryptPulsePlanData(delegatedDb, adminPass);
const outerPriya = delEnv.auth.users.find(u => u.id === 'u_priya');
assert.equal(outerPriya?.isAdmin, true, 'Outer auth metadata exposes isAdmin display hint for delegated admin');
const priyaRes = await ppDecryptWithUserCredentials(delEnv, 'u_priya', 'PriyaAdmin#88');
assert.equal(priyaRes.authRole, 'user');
assert.equal(priyaRes.userRecord.isAdmin, true, 'Authenticated inner DB confirms delegated Admin privilege');
assert.equal(priyaRes.masterPass, adminPass);

// Rotate Main Admin password -> old Admin password rejected, new Admin password succeeds
const rotatedAdminPass = 'NewMainAdminPass#2027!';
const rotatedDb = JSON.parse(JSON.stringify(delegatedDb));
rotatedDb.accessControl.users.forEach(u => {
  u.keySlot = null;
  u.needsAdminKeyReset = true;
  u.mustChangePassword = true;
});
const rotatedEnv = await encryptPulsePlanData(rotatedDb, rotatedAdminPass);
assert.equal(rotatedEnv.auth, undefined, 'Scrubbed users awaiting key reset are omitted from outer auth until reset');
await assert.rejects(
  () => ppDecryptWithUserCredentials(rotatedEnv, '__ADMIN__', adminPass),
  /Decryption failed/,
  'Previous Main Administrator password must be rejected after rotation'
);
const rotatedRes = await ppDecryptWithUserCredentials(rotatedEnv, '__ADMIN__', rotatedAdminPass);
assert.equal(rotatedRes.authRole, 'admin');
assert.equal(rotatedRes.masterPass, rotatedAdminPass);
assert.equal(JSON.parse(rotatedRes.plainJson).projects[0].code, 'NVA');

console.log('All 8 PulsePlanSecure AES-256-GCM, multi-user wrapped-key & Admin rotation tests passed.');
