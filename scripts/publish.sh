#!/usr/bin/env bash

npm run contributors
npm run build
git add .
lerna publish $* --conventional-commits
