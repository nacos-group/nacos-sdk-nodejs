#!/bin/sh

git filter-branch -f --env-filter '
if [ "$GIT_AUTHOR_NAME" = "张挺" ]
then
export GIT_AUTHOR_NAME="Harry Chen"
export GIT_AUTHOR_EMAIL="czy88840616@gmail.com"
fi
' d7feec1..HEAD

git filter-branch -f --env-filter '
if [ "$GIT_COMMITTER_NAME" = "张挺" ]
then
export GIT_COMMITTER_NAME="Harry Chen"
export GIT_COMMITTER_EMAIL="czy88840616@gmail.com"
fi
' d7feec1..HEAD
