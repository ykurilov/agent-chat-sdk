#!/bin/sh
# Из корня SDK внутри imac-run: сборка и pack в одном прогоне, чтобы rsync не удалил dist между ними.
set -eu
sdk_root="$PWD"
pack_root=$(mktemp -d "$HOME/work/124-sdk-pack.XXXXXX")
mkdir -p "$pack_root/tars" "$pack_root/consumer"
pnpm --filter @ykurilov/agent-chat-attachments... --filter @ykurilov/agent-chat-server... --workspace-concurrency=4 build
pnpm --dir packages/core pack --pack-destination "$pack_root/tars" >"$pack_root/pack-core.log" 2>&1
pnpm --dir packages/server pack --pack-destination "$pack_root/tars" >"$pack_root/pack-server.log" 2>&1
pnpm --dir packages/attachments pack --pack-destination "$pack_root/tars" >"$pack_root/pack-attachments.log" 2>&1
python3 - "$pack_root" <<'PY'
from pathlib import Path
import sys, json, tarfile
root = Path(sys.argv[1])
deps = {}
for name in ['core', 'server', 'attachments']:
    package = '@ykurilov/agent-chat-' + name
    archive = next((root / 'tars').glob('*chat-' + name + '-*.tgz'))
    with tarfile.open(archive) as tar:
        assert 'package/dist/index.js' in tar.getnames(), f'pack without dist: {package}'
    deps[package] = 'file:' + str(archive)
source = Path('package.json')
core = json.loads(Path('packages/core/package.json').read_text())
sdk = json.loads(source.read_text())
manifest = {'name': 'sdk-124-consumer', 'private': True, 'type': 'module',
    'packageManager': sdk['packageManager'],
    'dependencies': {**deps, 'ai': core['dependencies']['ai']},
    'devDependencies': {k: sdk['devDependencies'][k] for k in ['typescript', '@types/node']},
    'pnpm': {'overrides': deps}}
(root / 'consumer/package.json').write_text(json.dumps(manifest))
(root / 'consumer/.npmrc').write_text('auto-install-peers=false\n')
PY
cp "$sdk_root/scripts/tests/fixtures/chat-app-contracts-consumer.mts" "$pack_root/consumer/smoke.mts"
cd "$pack_root/consumer"
pnpm install --ignore-scripts
pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2023 --lib ES2023,DOM,DOM.Iterable,DOM.AsyncIterable --strict --types node --skipLibCheck smoke.mts
SMOKE_PNG_BASE64=$(python3 - <<'PY'
import zlib, struct, base64
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\0\xff\0\0')) + chunk(b'IEND', b'')
print(base64.b64encode(png).decode())
PY
)
export SMOKE_PNG_BASE64
node smoke.mts
printf 'PACK ARTIFACTS: %s\n' "$pack_root"
