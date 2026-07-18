const { AsyncLocalStorage } = require('async_hooks');

const diagnosticStorage = new AsyncLocalStorage();

function cleanDiagnosticContext(value) {
  if (!value || typeof value !== 'object') return null;

  const clean = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    if (Array.isArray(rawValue)) {
      const filtered = rawValue
        .map(item => String(item || '').trim())
        .filter(Boolean);
      if (filtered.length > 0) clean[key] = filtered;
      continue;
    }
    if (typeof rawValue === 'boolean' || typeof rawValue === 'number') {
      clean[key] = rawValue;
      continue;
    }
    clean[key] = String(rawValue);
  }

  return Object.keys(clean).length > 0 ? clean : null;
}

function getDiagnosticContext() {
  return cleanDiagnosticContext(diagnosticStorage.getStore());
}

function runWithDiagnosticContext(context, fn) {
  const parent = diagnosticStorage.getStore() || {};
  const next = cleanDiagnosticContext({ ...parent, ...(context || {}) }) || {};
  return diagnosticStorage.run(next, fn);
}

function mergeDiagnosticContext(context) {
  const parent = diagnosticStorage.getStore() || {};
  return cleanDiagnosticContext({ ...parent, ...(context || {}) });
}

module.exports = {
  getDiagnosticContext,
  runWithDiagnosticContext,
  mergeDiagnosticContext
};
