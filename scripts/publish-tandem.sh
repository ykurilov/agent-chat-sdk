#!/usr/bin/env bash
# Выпуск дизайн-системы Тандем в npm (registry.npmjs.org) как @ykurilov/tandem-ui, открыто.
#
#   TANDEM_REPO=<папка репозитория Тандема> scripts/publish-tandem.sh            — версия берётся из packages/ui/package.json Тандема
#   TANDEM_REPO=<папка репозитория Тандема> scripts/publish-tandem.sh 0.3.0      — версия задана вручную (только в выпуске; репозиторий Тандема не меняется)
#
# Что делает: берёт последний коммит (HEAD) репозитория Тандема, распаковывает его во временную папку,
# ставит зависимости (`npm ci`, при этом собирается dist), переименовывает пакет в @ykurilov/tandem-ui,
# прописывает npm и репозиторий и публикует. Лицензию задаёт сам Тандем (поле license в packages/ui/package.json):
# без неё скрипт останавливается — придумывать лицензию за Тандем нельзя. Сам репозиторий Тандема не читается и не меняется,
# кроме `git archive HEAD`: незакоммиченные правки в выпуск не попадают.
#
# Ключ npm с правом записи в пакеты @ykurilov: переменная NPM_TOKEN, файл ~/.config/agent-chat-sdk/npm-token
# (другой путь — NPM_TOKEN_FILE в окружении или строкой NPM_TOKEN_FILE=… в ~/.config/agent-chat-sdk/release.env)
# или строка //registry.npmjs.org/:_authToken=… в ~/.npmrc. Ключ не печатается.
set -euo pipefail

TANDEM_REPO="${TANDEM_REPO:?Укажите папку репозитория Тандема: TANDEM_REPO=<путь> scripts/publish-tandem.sh}"
REGISTRY="https://registry.npmjs.org"
NEW_NAME="@ykurilov/tandem-ui"
REPOSITORY_URL="git+https://github.com/ykurilov/agent-chat-sdk.git"
REPOSITORY_DIRECTORY="vendor/tandem-ui"
VERSION_OVERRIDE="${1:-}"

commit="$(git -C "$TANDEM_REPO" rev-parse --short HEAD)"
uncommitted="$(git -C "$TANDEM_REPO" status --porcelain -- packages/ui package.json package-lock.json)"
if [ -n "$uncommitted" ]; then
  echo "⚠ В репозитории Тандема есть незакоммиченные правки пакета — в выпуск они НЕ попадут (берётся коммит $commit):"
  echo "$uncommitted" | sed 's/^/    /'
fi

workdir="$(mktemp -d "${TMPDIR:-/tmp}/tandem-publish.XXXXXX")"
trap 'rm -rf "$workdir"' EXIT

echo "▶ Беру коммит $commit из $TANDEM_REPO"
git -C "$TANDEM_REPO" archive HEAD | tar -x -C "$workdir"
license="$(node -p "require('$workdir/packages/ui/package.json').license || ''")"
if [ -z "$license" ]; then
  echo "✋ В packages/ui/package.json Тандема (коммит $commit) нет поля license. Лицензию Тандема выбирает автор: впишите её в Тандем, закоммитьте и запустите снова." >&2
  exit 1
fi

echo "▶ Ставлю зависимости и собираю (npm ci)"
(cd "$workdir" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund)

echo "▶ Переименовываю пакет в $NEW_NAME"
NEW_NAME="$NEW_NAME" REGISTRY="$REGISTRY" REPOSITORY_URL="$REPOSITORY_URL" REPOSITORY_DIRECTORY="$REPOSITORY_DIRECTORY" \
VERSION_OVERRIDE="$VERSION_OVERRIDE" node - "$workdir/packages/ui/package.json" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const file = process.argv[2];
const pkg = JSON.parse(readFileSync(file, "utf8"));
pkg.name = process.env.NEW_NAME;
if (process.env.VERSION_OVERRIDE) pkg.version = process.env.VERSION_OVERRIDE;
pkg.publishConfig = { registry: process.env.REGISTRY, access: "public" };
pkg.repository = { type: "git", url: process.env.REPOSITORY_URL, directory: process.env.REPOSITORY_DIRECTORY };
writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
NODE

version="$(node -p "require('$workdir/packages/ui/package.json').version")"
if [ ! -f "$workdir/packages/ui/dist/index.js" ]; then
  echo "✋ После npm ci нет packages/ui/dist/index.js — сборка не прошла. Публикация отменена." >&2
  exit 1
fi
if npm view "$NEW_NAME@$version" version --registry "$REGISTRY" >/dev/null 2>&1; then
  echo "✋ $NEW_NAME@$version уже есть в npm. Поднимите версию в packages/ui/package.json Тандема (и закоммитьте) или передайте новую: scripts/publish-tandem.sh <версия>." >&2
  exit 1
fi

echo "▶ Публикую $NEW_NAME@$version"
release_env="$HOME/.config/agent-chat-sdk/release.env"
if [ -z "${NPM_TOKEN_FILE:-}" ] && [ -f "$release_env" ]; then
  NPM_TOKEN_FILE="$(sed -n 's/^NPM_TOKEN_FILE=//p' "$release_env" | tail -1 | tr -d '"'"'"'"')"
  NPM_TOKEN_FILE="${NPM_TOKEN_FILE/#\~/$HOME}"
fi
token_file="${NPM_TOKEN_FILE:-$HOME/.config/agent-chat-sdk/npm-token}"
if [ -z "${NPM_TOKEN:-}" ] && [ -f "$token_file" ]; then
  NPM_TOKEN="$(tr -d '[:space:]' < "$token_file")"
fi
if [ -n "${NPM_TOKEN:-}" ]; then
  # Временный .npmrc со ссылкой на переменную, а не с самим ключом; удаляется вместе с workdir.
  (umask 077 && printf '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' > "$workdir/.npmrc-publish")
  (cd "$workdir/packages/ui" && NPM_TOKEN="$NPM_TOKEN" NPM_CONFIG_USERCONFIG="$workdir/.npmrc-publish" npm publish)
else
  (cd "$workdir/packages/ui" && npm publish)
fi
echo "✅ Опубликовано $NEW_NAME@$version (коммит Тандема $commit)."
echo "   Дальше: в skins/tandem и apps/demo этого репозитория — \"@tandem/ui\": \"npm:$NEW_NAME@^$version\", pnpm install, запись в .changeset."
