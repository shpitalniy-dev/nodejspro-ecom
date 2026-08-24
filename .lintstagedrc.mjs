export default {
  '*.{js,ts}': ['eslint --fix --max-warnings 0'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
  'package.json': ['sort-package-json'],
};
