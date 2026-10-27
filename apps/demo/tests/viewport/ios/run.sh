#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
export NODE_OPTIONS=--max-old-space-size=1024 GOMAXPROCS=1
export TEST_RUNNER_VECLIB_MAXIMUM_THREADS=2 TEST_RUNNER_OMP_NUM_THREADS=2
mkdir -p test-results/viewport-native
pnpm exec vite --config viewport.vite.config.ts > test-results/viewport-native/vite.log 2>&1 &
server=$!
device=""
recorder=""
video=""
cleanup() {
  local result=$?
  trap - EXIT
  set +e
  if [ -n "$recorder" ]; then
    kill -INT "$recorder" 2>/dev/null || true
    for _ in {1..30}; do if ! kill -0 "$recorder" 2>/dev/null; then break; fi; sleep 0.2; done
    if kill -0 "$recorder" 2>/dev/null; then kill -TERM "$recorder" 2>/dev/null || true; sleep 1; fi
    if kill -0 "$recorder" 2>/dev/null; then kill -KILL "$recorder" 2>/dev/null || true; fi
    wait "$recorder" 2>/dev/null || true
    if [ -f "$video" ]; then cp "$video" ../../../test-results/viewport-native/keyboard.mp4 || true; fi
  fi
  if [ -n "$device" ]; then xcrun simctl shutdown "$device" 2>/dev/null || true; xcrun simctl delete "$device" 2>/dev/null || true; fi
  kill "$server" 2>/dev/null || true
  exit "$result"
}
trap cleanup EXIT
for i in {1..30}; do if curl -fsS http://127.0.0.1:6155/ > /dev/null; then break; fi; sleep 1; done
cd tests/viewport/ios
xcodegen generate
result="../../../test-results/viewport-native/result-$(date +%Y%m%d-%H%M%S).xcresult"
device=$(xcrun simctl create SDK155-Safari com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro com.apple.CoreSimulator.SimRuntime.iOS-26-5)
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
open -a Simulator --args -CurrentDeviceUDID "$device"
video="../../../test-results/viewport-native/keyboard-$(date +%Y%m%d-%H%M%S).mp4"
python3 -c 'import os,signal,sys; signal.signal(signal.SIGINT,signal.SIG_DFL); os.execvp("xcrun",["xcrun","simctl","io"]+sys.argv[1:])' "$device" recordVideo "$video" > ../../../test-results/viewport-native/video.log 2>&1 &
recorder=$!
args=(test)
if [ -n "${SDK_VIEWPORT_ONLY:-}" ]; then args+=("-only-testing:ViewportSafariTests/KeyboardTests/$SDK_VIEWPORT_ONLY"); fi
xcodebuild "${args[@]}" -project ViewportSafari.xcodeproj -scheme ViewportSafari -destination "platform=iOS Simulator,id=$device" -derivedDataPath ../../../test-results/viewport-derived -resultBundlePath "$result" -parallel-testing-enabled NO -jobs 2 CODE_SIGNING_ALLOWED=NO > ../../../test-results/viewport-native/xcode.log 2>&1
