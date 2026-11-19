---
__default__: patch
---

On the GTK desktop host on Linux, `Battery` reads UPower's display device and whether the machine runs on battery, with low power from the PowerProfileMonitor portal or power-profiles-daemon, and has no battery where UPower does not answer; `Network` names Wi-Fi, Ethernet or cellular from NetworkManager's primary connection, and `OTHER` without NetworkManager; and `Location` takes fixes and watches through the Location portal (GeoClue behind it), whose answer at the first start is the permission, restricted where no Location portal answers. Geocoding stays absent on Linux.
