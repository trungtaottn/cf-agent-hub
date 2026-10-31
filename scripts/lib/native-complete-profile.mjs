/** Fixed MVP conformance fixture admission. No I/O, authority or effect callbacks.
 * Logical commands, process windows, service calls and bytes are different units.
 * This profile does not widen product limits or satisfy native acceptance.
 */
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {canonicalCaseSubject} from './r2-case-policy.mjs';
import fixture from './native-complete-fixture.json' with {type:'json'};
import {getNativeScenario} from './native-r2-scenario.mjs';
import ledger from './native-complete-ledger.json' with {type:'json'};
import processOffers from './native-complete-processes.json' with {type:'json'};
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const scenario = getNativeScenario();
const unavailable = freeze([
  'control/prepare-swap-slot',
  'control/prepare-swap-generation',
  'control/prepare-swap-principal',
]);
const profile = freeze({
  version: 2,
  profile: 'native-r2-complete-prepared-v1',
  implementation_status: 'contract-and-selected-state-only',
  steps: scenario.steps.map(step => step.id),
  external: scenario.externalRequirements.map(step => step.id),
  processes: processOffers,
  inputs: scenario.steps.filter(step => step.refKeys.includes('input_file')).map(step => step.id),
  artifact: {
    text: 'Native conformance artifact.\n',
    byte_size: 29,
    sha256: 'eefb414947860e55eb533966c87bb64b6d38ea4514768cf10f4a16721ee876b2',
  },
  // Commands are logical admissions, not spawned shells or HTTP requests.
  reservation: {commands: 489, mutations: 46, artifact_bytes: 174, output_bytes: 22890667},
  limits: {
    service_calls: 370, application_requests: 57, private_select_admissions: 2555,
    private_canonical_bytes: 7888422, process_output_bytes: 188416,
    scanner_raw_bytes: 376832,
  },
  // Cumulative logical work above is not release size or peak memory.
  release: {
    records: 509, total_bytes: 11019596, joint_cap: 16777216,
    per_original_cap: 65536, headroom: 5757620,
  },
  unavailable,
  ledger,
  fixture,
});
const sum = value => Object.values(value).reduce((total, next) => total + next, 0);
if (sum(ledger.logical_commands) !== profile.reservation.commands ||
    sum(ledger.mutation_attempts) !== profile.reservation.mutations ||
    sum(ledger.logical_output_bytes) !== profile.reservation.output_bytes ||
    sum(ledger.service_calls) !== profile.limits.service_calls ||
    ledger.report_original_families.reduce((total, row) => total + row.count, 0) !== profile.release.records ||
    ledger.report_original_families.reduce((total, row) => total + row.bytes, 0) +
      ledger.logical_output_bytes.assembly_structural_fragment +
      ledger.logical_output_bytes.report2_reference_wrapper !== profile.release.total_bytes) {
  throw Error('NATIVE_COMPLETE_PROFILE_SOURCE_MISMATCH');
}
const processSteps = scenario.steps.filter(step => step.kind !== 'control').map(step => step.id);
if (profile.steps.length !== 68 || profile.external.length !== 2 ||
    profile.inputs.length !== 27 || processSteps.length !== 56 ||
    processOffers.length !== 56 || processOffers.some((row, index) =>
      row.step_id !== processSteps[index] || !Number.isSafeInteger(row.output_bytes) || row.output_bytes <= 0) ||
    processOffers.reduce((total, row) => total + row.output_bytes, 0) !== profile.limits.process_output_bytes) {
  throw Error('NATIVE_COMPLETE_PROFILE_SOURCE_MISMATCH');
}
export function getCompleteProfile() { return profile; }

/** Explicit complete-profile budget only; never dispatch an untagged v1 budget here.
 * Duration is structural. Installed expiry, lease and cleanup grace are separate
 * admission checks, not a promise that a 300-second execution can succeed.
 */
export function validateCompleteBudget(input) {
  const reject = () => { throw Error('NATIVE_COMPLETE_BUDGET_REJECTED'); };
  if (!input || typeof input !== 'object' || types.isProxy(input) ||
      Object.getPrototypeOf(input) !== Object.prototype) reject();
  const expected = [...Object.keys(profile.reservation), 'duration_ms'];
  const keys = Reflect.ownKeys(input);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) reject();
  const copy = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable ||
        !Number.isSafeInteger(descriptor.value)) reject();
    const value = descriptor.value;
    if (key === 'duration_ms' ? value < 1 || value > 300000 : value !== profile.reservation[key]) reject();
    copy[key] = value;
  }
  return Object.freeze(copy);
}

/** Source-owned feasibility, not caller assertions or an installed permission.
 * Unsupported mandatory obligations must stop a full run before any effects.
 */
export function requireCompleteCapabilities() {
  const error = Error('NATIVE_COMPLETE_CAPABILITIES_UNAVAILABLE');
  Object.defineProperty(error, 'unavailable', {value: unavailable, enumerable: true});
  throw error;
}

/** Canonical constraint/recipe commitments; authentic fixture admission is separate. */
export function getCompleteCommitments() {
  const sha = value => createHash('sha256').update(canonicalCaseSubject(value)).digest('hex');
  return Object.freeze({fixture_sha256: sha(fixture), family_ledger_sha256: sha(ledger)});
}
