#!/usr/bin/env bash

npm run contributors
npm run build
git add .
git commit -m "chore: ready for publish"
lerna publish $*
