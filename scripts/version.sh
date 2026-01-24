#!/bin/sh

# Get the new version from package.json
NEW_VERSION=$(node -p "require('./package.json').version")

echo "Updating native app versions to $NEW_VERSION..."

# Update iOS versions
IOS_PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
if [ -f "$IOS_PBXPROJ" ]; then
  # Update MARKETING_VERSION
  sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $NEW_VERSION;/g" "$IOS_PBXPROJ"
  
  # Increment CURRENT_PROJECT_VERSION (build number)
  BUILD_NUMBER=$(grep -m1 "CURRENT_PROJECT_VERSION = " "$IOS_PBXPROJ" | sed 's/.*= \([0-9]*\);/\1/')
  NEW_BUILD_NUMBER=$((BUILD_NUMBER + 1))
  sed -i '' "s/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/CURRENT_PROJECT_VERSION = $NEW_BUILD_NUMBER;/g" "$IOS_PBXPROJ"
  
  echo "✓ iOS: version $NEW_VERSION, build $NEW_BUILD_NUMBER"
else
  echo "⚠ iOS project file not found"
fi

# Update Android versions
ANDROID_GRADLE="android/app/build.gradle"
if [ -f "$ANDROID_GRADLE" ]; then
  # Update versionName
  sed -i '' "s/versionName \"[^\"]*\"/versionName \"$NEW_VERSION\"/" "$ANDROID_GRADLE"
  
  # Increment versionCode
  VERSION_CODE=$(grep "versionCode " "$ANDROID_GRADLE" | awk '{print $2}')
  NEW_VERSION_CODE=$((VERSION_CODE + 1))
  sed -i '' "s/versionCode $VERSION_CODE/versionCode $NEW_VERSION_CODE/" "$ANDROID_GRADLE"
  
  echo "✓ Android: versionName $NEW_VERSION, versionCode $NEW_VERSION_CODE"
else
  echo "⚠ Android build.gradle not found"
fi

echo "Native versions updated successfully!"

# Stage the native version files for the upcoming version commit
git add ios/App/App.xcodeproj/project.pbxproj android/app/build.gradle
