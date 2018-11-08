'use strict';

module.exports = {
  write: true,
  prefix: '^',
  devprefix: '^',
  exclude: [
    'test/fixtures',
    'examples',
    'docs',
    'run',
  ],
  devdep: [
    '@types/mocha',
    '@types/node',
    'tslint'
  ],
  keep: [
    'ts-node',
    'typescript',
  ]
};
