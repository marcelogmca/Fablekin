const assert = require('node:assert/strict');
const test = require('node:test');

const director = require('./director.js');

test('Director omits empty private prompt sections', () => {
  const formatSection = director._test.formatDirectorPrivateSection;

  assert.equal(formatSection('# PRIVATE CANON', 'canon_data', ''), '');
  assert.equal(formatSection('# PRIVATE CANON', 'canon_data', '  \n\t'), '');
  assert.equal(formatSection('# PRIVATE CANON', 'canon_data', null), '');
});

test('Director renders populated private prompt sections', () => {
  const rendered = director._test.formatDirectorPrivateSection(
    '# PRIVATE CANON',
    'canon_data',
    '  The old bridge is sealed.  '
  );

  assert.equal(
    rendered,
    '# PRIVATE CANON\n<canon_data>\nThe old bridge is sealed.\n</canon_data>'
  );
});
