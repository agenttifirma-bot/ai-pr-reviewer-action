# Releasing

Only the maintainer releases. Nothing in CI creates tags or releases.

## Checklist before a release

1. `npm test` passes on Node 22 and 24 (CI on `master` is green).
2. `package.json` `version` is the new version. The README files and `examples/review.yml` reference `@vX.Y.Z` with the same version (`test/repo.test.js` checks this).
3. `CHANGELOG.md`: the "Julkaisematon" section is renamed to the new version and date.
4. `SECURITY.md`: "Supported versions" names the new version.
5. `action.yml`: `name` is unique in the Marketplace, `description` is at most 125 characters, `branding` uses an allowed Feather icon and color (`test/repo.test.js` checks the format).

## First Marketplace publication

Requirements (GitHub docs, "Publishing actions in GitHub Marketplace"): public repository, one `action.yml` at the root, unique `name`, two-factor authentication on the publishing account, and the GitHub Marketplace Developer Agreement accepted.

1. Open `action.yml` on GitHub and click **Draft a release** in the banner.
2. Select **Publish this Action to the GitHub Marketplace** and accept the Developer Agreement if asked.
3. Fix any metadata warnings until the page says "Everything looks good!".
4. Primary category: **Code review**. Another category: **Security** (suggestion).
5. Tag: the new `vX.Y.Z`, target `master`. Title: `vX.Y.Z`. Paste the version's CHANGELOG section as the release notes.
6. Click **Publish release**.

## Every later release

1. Do the checklist above.
2. Create the release `vX.Y.Z` on GitHub (keep the Marketplace box checked).
3. From 1.0.0 on, move the major tag so `@v1` users get the release:

   ```bash
   git fetch --tags
   git tag -f v1 vX.Y.Z
   git push -f origin v1
   ```

   Do not move `vX.Y.Z` tags. Only the major tag moves.
4. A breaking change (removed or renamed input, changed default limit) needs a new major version (`v2`).

If immutable releases are enabled in the repository settings, release tags cannot be moved or deleted after publishing; read GitHub's "Using immutable releases and tags to manage your action's releases" before enabling them.
