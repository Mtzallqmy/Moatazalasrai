#!/usr/bin/env bash
set -euo pipefail

mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${mobile_root}"

wrapper_jar="android/gradle/wrapper/gradle-wrapper.jar"
wrapper_properties="android/gradle/wrapper/gradle-wrapper.properties"

if [[ -x android/gradlew && -f "${wrapper_jar}" && -f "${wrapper_properties}" ]]; then
  exit 0
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter is required to regenerate the Android Gradle wrapper." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1 || ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "A Git checkout is required to preserve the tracked Android configuration." >&2
  exit 1
fi

if [[ -n "$(git status --short -- android)" ]]; then
  echo "Refusing to regenerate the Android wrapper while Android files have local changes." >&2
  exit 1
fi

wrapper_tmp="$(mktemp -d)"
trap 'rm -rf "${wrapper_tmp}"' EXIT

generated_project="${wrapper_tmp}/generated"
flutter create \
  --platforms=android \
  --project-name=moataz_ai_mobile \
  --org=com.moataz \
  --no-pub \
  "${generated_project}"

generated_android="${generated_project}/android"
if [[ ! -x "${generated_android}/gradlew" \
  || ! -f "${generated_android}/gradle/wrapper/gradle-wrapper.jar" \
  || ! -f "${generated_android}/gradle/wrapper/gradle-wrapper.properties" ]]; then
  echo "Flutter did not generate a complete Android Gradle wrapper." >&2
  exit 1
fi

mkdir -p android/gradle/wrapper
cp "${generated_android}/gradlew" android/gradlew
cp "${generated_android}/gradlew.bat" android/gradlew.bat
cp "${generated_android}/gradle/wrapper/gradle-wrapper.jar" "${wrapper_jar}"
cp "${generated_android}/gradle/wrapper/gradle-wrapper.properties" "${wrapper_properties}"
chmod +x android/gradlew
