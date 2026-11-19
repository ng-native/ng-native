// The runtime tests: Hermes and the core's runtime half, linked as a host links them, with no
// toolkit. Built wherever the runtime is (scripts/build.sh --runtime, or with a backend).
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest/doctest.h>
