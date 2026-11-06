Please do not create a Pull Request without creating an issue first.

## What is the purpose of the change

XXXXX

## Brief changelog

XX

## Verifying this change

XXXX

Follow this checklist to help us incorporate your contribution quickly and easily:

* [ ] Make sure there is a Github issue filed for the change (usually before you start working on it). Trivial changes like typos do not require a Github issue. Your pull request should address just this issue, without pulling in other changes - one PR resolves one issue.
* [ ] Format the pull request title with Conventional Commits, like `fix: reject ready when login is refused`. Each commit in the pull request should have a meaningful subject line and body.
* [ ] Write a pull request description that is detailed enough to understand what the pull request does, how, and why.
* [ ] Update the matching specs under `specs/` if the change affects behavior, public APIs, options, lifecycle, or error mapping.
* [ ] Write necessary unit tests to verify your logic. If a public client contract changes, update the test scenarios and coverage registry, and add integration tests that go through the public client.
* [ ] Run `pnpm -r run build` and the affected unit and integration tests. See `AGENTS.md` for the commands.
