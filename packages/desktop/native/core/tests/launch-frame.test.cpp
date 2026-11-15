#include "fake-backend.h"
#include "ngn/launch-frame.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;
using ngn::testing::FakeBackend;

namespace {

void commit(ngn::MountingManager &mounting, SurfaceId surface) {
  mounting.executeMount(surface, MountingTransaction(surface, 1, {}, {}));
}

} // namespace

TEST_CASE("a mount is recorded under the instance that committed it, even when applied after a new one began") {
  auto backend = std::make_shared<FakeBackend>();
  auto mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  CHECK(mounting->mountedBy(1) == 0);
  auto first = mounting->beginInstance();
  commit(*mounting, 1);
  backend->drain();
  CHECK(mounting->mountedBy(1) == first);

  // The first instance's last commit is still queued as a reload begins the second.
  commit(*mounting, 1);
  auto second = mounting->beginInstance();
  CHECK(second != first);
  CHECK(mounting->instance() == second);
  backend->drain();
  CHECK(mounting->mountedBy(1) == first);
  CHECK(mounting->mountedBy(2) == 0);
  commit(*mounting, 1);
  commit(*mounting, 2);
  backend->drain();
  CHECK(mounting->mountedBy(1) == second);
  CHECK(mounting->mountedBy(2) == second);
}

TEST_CASE("a launch's success timer starts from its own instance's first frame, once") {
  ngn::LaunchFrame frame;
  // Nothing loaded: nothing owed.
  CHECK_FALSE(frame.shown(1, 1));
  frame.loaded(1, 1);
  CHECK_FALSE(frame.shown(2, 1));
  CHECK(frame.shown(1, 1) == 1u);
  CHECK_FALSE(frame.shown(1, 1));
}

TEST_CASE("after a reload, the last launch's content and its queued mounts never count for the new launch") {
  ngn::LaunchFrame frame;
  frame.loaded(1, 1);
  // The reload began (launch 2) before launch 1's first frame was shown: launch 1's queued mount
  // counts for neither.
  CHECK_FALSE(frame.shown(1, 2));
  // Launch 2's bundle loaded into instance 2, while launch 1's content is still on screen.
  frame.loaded(2, 2);
  CHECK_FALSE(frame.shown(1, 2));
  CHECK(frame.shown(2, 2) == 2u);
}

TEST_CASE("a reload whose bundle did not load owes no frame") {
  ngn::LaunchFrame frame;
  frame.loaded(1, 1);
  // Launch 2 began and its bundle failed: it never loaded. Its instance's frames (a red box, or
  // the old content) start nothing.
  CHECK_FALSE(frame.shown(1, 2));
  CHECK_FALSE(frame.shown(2, 2));
}

TEST_CASE("a launch loaded after another reload began owes nothing for the newer launch") {
  ngn::LaunchFrame frame;
  // Launch 2 loaded, but launch 3 began before its frame showed.
  frame.loaded(2, 2);
  CHECK_FALSE(frame.shown(2, 3));
}
