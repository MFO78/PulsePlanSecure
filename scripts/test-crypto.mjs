#!/usr/bin/env node
/**
 * Automated AES-256-GCM + PBKDF2-SHA-256 cryptography test suite for PulsePlanSecure.
 * Verifies round-trip encryption/decryption, wrong-passphrase rejection, and tamper detection.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = fs.readFileSync(path.join(process.cwd(), 'src', 'js', '13-security-licence.js'), 'utf8');
const sandbox = {
  crypto: globalThis.crypto,
  TextEncoder,
  TextDecoder,
  btoa: globalThis.btoa,
  atob: globalThis.atob,
  console,
  setTimeout,
  clearTimeout,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const sampleDb = {
  meta: { version: 3, revision: 42 },
  departments: [{ id: 'd_eng', name: 'Engineering', defaultCapacity: 8 }],
  projects: [{ id: 'p_nova', name: 'Project Nova', code: 'NVA' }],
  allocations: { 'd_eng::p_nova::2026-W47': 2.5 },
};

// 1. Round-trip encrypt & decrypt
const envelope = await sandbox.encryptPulsePlanData(sampleDb, 'CorrectHorseBatteryStaple!');
assert.equal(envelope.format, 'pulseplan-encrypted-v1');
assert.equal(envelope.cipher, 'AES-256-GCM');
assert.equal(envelope.iterations, 250000);
assert.ok(!envelope.ciphertext.includes('Engineering'), 'Plaintext must not leak into ciphertext');

const plainJson = await sandbox.decryptPulsePlanData(envelope, 'CorrectHorseBatteryStaple!');
assert.deepEqual(JSON.parse(plainJson), sampleDb, 'Decrypted DB must match original');

// 2. Wrong passphrase must reject
await assert.rejects(
  () => sandbox.decryptPulsePlanData(envelope, 'WrongPassphrase123!'),
  /Decryption failed/,
  'Wrong passphrase must fail AES-GCM authentication'
);

// 3. Tampered ciphertext must reject
const tampered = { ...envelope, ciphertext: 'AAAA' + envelope.ciphertext.slice(4) };
await assert.rejects(
  () => sandbox.decryptPulsePlanData(tampered, 'CorrectHorseBatteryStaple!'),
  /Decryption failed/,
  'Tampered ciphertext must fail AES-GCM authentication'
);

// 4. Short passphrase must reject
await assert.rejects(
  () => sandbox.encryptPulsePlanData(sampleDb, 'short'),
  /at least 8 characters/,
  'Passphrases under 8 characters must be rejected'
);

console.log('All 4 PulsePlanSecure AES-256-GCM cryptography tests passed.');
