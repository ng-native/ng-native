// Force-included into react-native-worklets' shared C++ on Linux
// (cmake/libraries/react-native-worklets.cmake), for what it takes from Apple's libraries that
// glibc and libstdc++ do not give:
// - <algorithm>, <iterator> and <stdexcept>, which some of its sources use without including:
//   libc++ brings them in through other headers, and libstdc++ does not.
// - The one-argument pthread_setname_np, which worklets 0.13 calls on every OS but Android to name
//   the thread an AsyncQueue starts. glibc's takes the thread and at most 15 bytes of name, and
//   refuses a longer one, so the name is cut to fit.
#pragma once

#include <pthread.h>

#include <algorithm>
#include <cstring>
#include <iterator>
#include <stdexcept>

inline int pthread_setname_np(const char *name) {
  char fitted[16];
  std::strncpy(fitted, name, sizeof(fitted) - 1);
  fitted[sizeof(fitted) - 1] = '\0';
  return pthread_setname_np(pthread_self(), fitted);
}
