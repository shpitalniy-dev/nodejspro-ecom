// HW #32 architecture gate. Makes "the data layer doesn't know about HTTP"
// checkable: entities and repositories never import from controllers.
// services/, workers/ and transactions/ do import controllers today, so a
// stricter rule would fail on the real code, not on a defect.
/* global module */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'data-layer-not-to-controllers',
      severity: 'error',
      comment: 'entities/ and repositories/ must not import controllers/',
      from: { path: '(^|/)src/(entities|repositories)/' },
      to: { path: '(^|/)src/controllers/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
