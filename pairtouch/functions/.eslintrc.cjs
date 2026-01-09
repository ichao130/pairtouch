// functions/.eslintrc.cjs
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: ['google'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script', // CommonJS（require/exports）
  },
  globals: {
    require: 'readonly',
    exports: 'readonly',
    module: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    process: 'readonly',
  },
  rules: {
    'require-jsdoc': 'off',
    'valid-jsdoc': 'off',
    'no-console': 'off',
    'max-len': ['warn', { code: 140, ignoreUrls: true }],
    // 整形系は Prettier に寄せる想定で一旦オフ（後で戻せる）
    'comma-dangle': 'off',
    'indent': 'off',
    'object-curly-spacing': 'off',
    'quotes': 'off',
  },
};