/* eslint-disable no-undef */
import { transformAsync } from '@babel/core';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputFile = path.resolve(__dirname, '../lib/Tools.js');
const outputFile = path.resolve(__dirname, '../lib/esm/Tools.js');

const transformToolsToNamedExport = ({ types: t }) => {
   let toolsKeys = [];

   return {
      visitor: {
         VariableDeclarator(path) {
            if (t.isIdentifier(path.node.id) && path.node.id.name === 'Tools') {
               if (t.isObjectExpression(path.node.init)) {
                  path.node.init.properties.forEach((prop) => {
                     if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                        if (!prop.key.name.startsWith('_')) toolsKeys.push(prop.key.name);
                     } else if (t.isObjectMethod(prop) && t.isIdentifier(prop.key)) {
                        if (!prop.key.name.startsWith('_')) toolsKeys.push(prop.key.name);
                     }
                  });
               }
            }
         },
         IfStatement(path) {
            const test = path.node.test;
            if (
               t.isBinaryExpression(test, { operator: '!==' }) &&
               t.isUnaryExpression(test.left, { operator: 'typeof' }) &&
               t.isIdentifier(test.left.argument, { name: 'module' })
            ) {
               path.remove();
            }
         },
         Program: {
            exit(path) {
               path.unshiftContainer(
                  'body',
                  t.variableDeclaration('const', [
                     t.variableDeclarator(
                        t.identifier('require'),
                        t.callExpression(t.identifier('createRequire'), [
                           t.memberExpression(
                              t.metaProperty(t.identifier('import'), t.identifier('meta')),
                              t.identifier('url')
                           ),
                        ])
                     ),
                  ])
               );

               path.unshiftContainer(
                  'body',
                  t.importDeclaration(
                     [
                        t.importSpecifier(
                           t.identifier('createRequire'),
                           t.identifier('createRequire')
                        ),
                     ],
                     t.stringLiteral('module')
                  )
               );

               if (toolsKeys.length > 0) {
                  path.pushContainer(
                     'body',
                     t.exportNamedDeclaration(
                        t.variableDeclaration('const', [
                           t.variableDeclarator(
                              t.objectPattern(
                                 toolsKeys.map((key) =>
                                    t.objectProperty(
                                       t.identifier(key),
                                       t.identifier(key),
                                       false,
                                       true
                                    )
                                 )
                              ),
                              t.identifier('Tools')
                           ),
                        ])
                     )
                  );
               }

               path.pushContainer('body', t.exportDefaultDeclaration(t.identifier('Tools')));
            },
         },
      },
   };
};

async function run() {
   try {
      const code = await fs.readFile(inputFile, 'utf8');
      const result = await transformAsync(code, {
         plugins: [transformToolsToNamedExport],
         parserOpts: {
            plugins: [
               'classProperties',
               'classPrivateProperties',
               'classPrivateMethods',
               'privateIn',
            ],
         },
         configFile: false,
         babelrc: false,
         generatorOpts: {
            compact: false,
         },
      });

      await fs.mkdir(path.dirname(outputFile), { recursive: true });
      await fs.writeFile(outputFile, result.code);
      console.log(`Successfully transformed Tools.js to ESM at ${outputFile}`);
   } catch (err) {
      console.error('Error transforming Tools.js:', err);
      process.exit(1);
   }
}

run();
