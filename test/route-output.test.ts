import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RouteOutputProgress, validateRoute } from '../src/route-output.js';

test('streaming presentation handles every character boundary, escapes and partial numbers', () => {
  const text = '{"rationale":"先学\\u57fa础词\\n再学\\"场景\\"词，topicIds: [99] 😀","topicIds":[12345,6,789]}';
  const parser = new RouteOutputProgress();
  let rationale = '';

  for (const char of text) {
    rationale += parser.push(char);
  }

  assert.equal(rationale, JSON.parse(text).rationale);
  assert.equal(parser.count, 3);
  const reversed = new RouteOutputProgress();
  assert.equal(reversed.push('{"topicIds":[12'), '');
  assert.equal(reversed.count, 0);
  assert.equal(reversed.push('345,'), '');
  assert.equal(reversed.count, 1);
  assert.equal(reversed.push('6],"rationale":"理由"}'), '理由');
  assert.equal(reversed.count, 2);
});

test('route validation requires a nonempty rationale and exactly the full set of IDs', () => {
  assert.deepEqual(validateRoute({ rationale: ' 理由 ', topicIds: [3, 1, 2] }, [1, 2, 3]), { rationale: '理由', topicIds: [3, 1, 2] });

  for (const value of [
    { rationale: '', topicIds: [1, 2, 3] },
    { rationale: '理由', topicIds: [1, 2] },
    { rationale: '理由', topicIds: [1, 1, 3] },
    { rationale: '理由', topicIds: [1, 2, 4] },
    { rationale: '理由', topicIds: [1, 2, 3, 4] },
    { rationale: '理由', topicIds: ['1', 2, 3] },
    { rationale: '理由', topicIds: [1.5, 2, 3] },
  ]) {
    assert.throws(() => validateRoute(value, [1, 2, 3]));
  }
});
