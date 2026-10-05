#!/usr/bin/env bash
# Builds the app for GitHub Pages and publishes it to the `gh-pages` branch of `origin`.
#
#   npm run deploy:pages
#
# One-time setup on GitHub: Settings → Pages → Build and deployment → Source: "Deploy from a branch",
# Branch: gh-pages, folder: / (root). The site is then at https://<user>.github.io/<repo>/.
set -euo pipefail

cd "$(dirname "$0")/.."
remote_url="$(git remote get-url origin)"
repo="$(basename "${remote_url%.git}")"

echo "Building for /${repo}/ ..."
BASE_PATH="/${repo}/" npm run build

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R dist/. "$work/"
# Pages runs Jekyll by default, which ignores files that start with an underscore. This app has none, but be explicit.
touch "$work/.nojekyll"

cd "$work"
git init -q -b gh-pages
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-MechVox deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy@users.noreply.github.com}" \
  commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push --force "$remote_url" gh-pages:gh-pages
echo "Published. Site: https://$(echo "$remote_url" | sed -E 's#.*[:/]([^/]+)/[^/]+$#\1#').github.io/${repo}/"
