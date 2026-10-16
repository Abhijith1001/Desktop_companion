# Build environment for the Buddy Link phone app (no Android Studio needed):
#   docker build -t buddylink-build android
#   docker run --rm -v "<repo>/android:/src" -v buddylink-gradle:/root/.gradle -v buddylink-keys:/root/.android buddylink-build
FROM eclipse-temurin:17-jdk
ENV ANDROID_HOME=/opt/android GRADLE_VERSION=8.7
RUN apt-get update && apt-get install -y --no-install-recommends unzip wget && rm -rf /var/lib/apt/lists/* \
 && wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/t.zip \
 && mkdir -p $ANDROID_HOME/cmdline-tools && unzip -q /tmp/t.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest && rm /tmp/t.zip \
 && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses > /dev/null \
 && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0" > /dev/null \
 && wget -q https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip -O /tmp/g.zip \
 && unzip -q /tmp/g.zip -d /opt && rm /tmp/g.zip
ENV PATH=/opt/gradle-8.7/bin:$PATH
WORKDIR /src
CMD ["gradle", "--no-daemon", "-q", "assembleDebug"]
