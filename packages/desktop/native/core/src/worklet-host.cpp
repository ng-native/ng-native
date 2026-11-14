#include "ngn/worklet-host.h"

namespace ngn {

WorkletHost &workletHost() {
  static WorkletHost host;
  return host;
}

} // namespace ngn
