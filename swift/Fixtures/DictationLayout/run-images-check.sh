#!/bin/bash
set -euo pipefail
export AGENT_CHAT_YKDESIGN_PATH="${AGENT_CHAT_YKDESIGN_PATH:-$HOME/work/YKDesignSystem/swift/YKDesign}"
result="${IMAGES_RESULT:-build/images-check}"
mkdir -p "$result"
sim=$(xcrun simctl create "SDK Markdown images" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0)
cleanup() {
  runner_data=$(xcrun simctl get_app_container "$sim" org.agentchat.dictationfixture.uitests.xctrunner data 2>/dev/null || true)
  if [ -n "$runner_data" ] && [ -d "$runner_data/tmp/image-shots" ]; then
    cp -R "$runner_data/tmp/image-shots" "$result/" || true
  fi
  xcrun simctl shutdown "$sim" >/dev/null 2>&1 || true
  xcrun simctl delete "$sim" >/dev/null 2>&1 || true
}
trap cleanup EXIT
xcrun simctl boot "$sim"
xcrun simctl bootstatus "$sim" -b
xcodebuild test -project swift/Fixtures/DictationLayout/AgentChatNativeFixture.xcodeproj -scheme AgentChatNativeFixture -destination "platform=iOS Simulator,id=$sim" -derivedDataPath build/images-derived -resultBundlePath "$result/test.xcresult" -jobs 2 -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 -only-testing:NativeUITests/NativeUITests/testMarkdownImagesBothThemes
