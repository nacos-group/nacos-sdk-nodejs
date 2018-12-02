#!/usr/bin/env bash

npm run build
git add .
lerna publish $* --conventional-commits
