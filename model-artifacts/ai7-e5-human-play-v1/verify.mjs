import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inferSpatial } from './reference-inference.mjs';

function read(name, expectedHash) {
  const file = readFileSync(new URL(name, import.meta.url));
  if (expectedHash) assert.equal(createHash('sha256').update(file).digest('hex'), expectedHash);
  return JSON.parse(file);
}

const manifest = read('manifest.json');
const fixtures = read(manifest.fixtures.file, manifest.fixtures.sha256);
assert.equal(fixtures.observations.length, manifest.fixtures.count);
const results = [];
for (const item of manifest.models) {
  const policy = read(item.portable_file, item.portable_sha256);
  assert.equal(policy.id, item.id);
  assert.deepEqual(policy.model_config, item.model_config);
  assert.equal(fixtures.references[item.id].length, fixtures.observations.length);
  let probabilityError = 0;
  let valueError = 0;
  for (const [index, fixture] of fixtures.observations.entries()) {
    const legal = fixture.legal_action_ids;
    assert.deepEqual(legal, fixture.public_observation.legal);
    assert.deepEqual([...legal].sort((a,b)=>a-b), fixture.mask_true_indices);
    const actual = inferSpatial(policy.weights, fixture.board, fixture.side, policy.geometry, legal, policy.slots);
    const expected = fixtures.references[item.id][index];
    assert.equal(actual.prob.length, expected.probabilities.length);
    for (const [i, probability] of actual.prob.entries()) {
      assert(Number.isFinite(probability) && probability >= 0);
      probabilityError = Math.max(probabilityError, Math.abs(probability - expected.probabilities[i]));
    }
    assert(Math.abs(actual.prob.reduce((sum,p)=>sum+p,0)-1) < 1e-12);
    valueError = Math.max(valueError, Math.abs(actual.value - expected.value));
  }
  assert(probabilityError <= 1e-5 && valueError <= 1e-5, item.id);
  results.push({id:item.id,fixtures:fixtures.observations.length,probability_max_abs_error:probabilityError,value_max_abs_error:valueError});
}
console.log(JSON.stringify({status:'PASS',runtime:process.version,results},null,2));
