import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
   js.configs.recommended,
   ...tseslint.configs.recommended,
   {
      files: ['**/src/**/*.ts'],
      languageOptions: {
         parser: tseslint.parser,
         parserOptions: {
            project: false,
            sourceType: 'module',
            ecmaVersion: 'latest',
            tsconfigRootDir: __dirname,
         }
      },
      rules: {
         'no-console': 'warn',
         'no-fallthrough': 'off',
         'no-control-regex': 'off',
         '@typescript-eslint/no-explicit-any': 'warn',
      }
   }
];
