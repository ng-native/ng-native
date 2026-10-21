# Build environment for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository as the context, then audits the image offline:
# everything the build, the tests and a reproducer need must be fetched here.
FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    CI=1 \
    NX_DAEMON=false \
    NX_NO_CLOUD=true

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# pnpm at the version the root `packageManager` field names, and the tree CI installs.
RUN corepack enable && corepack install && pnpm install --frozen-lockfile

# The packages as they publish. The documentation site is not a package.
RUN pnpm nx run-many -t build --exclude=documentation

# Chromium for the web host's browser suite, so it can run offline.
RUN pnpm --filter @ng-native/web exec playwright install --with-deps chromium

# Cheap tests, to show the image works; a failure does not abort the build.
RUN pnpm nx run @ng-native/integration-tests:test || echo "WARNING: integration tests reported failures"
