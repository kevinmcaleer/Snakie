- **Web: the app no longer freezes when it reloads into a new deploy.** The
  update check reloaded the page the moment a new service worker reached
  `installed`, so the reload went to the old worker just as `skipWaiting` shut
  it down; the navigation was cut off ("Failed to fetch" in sw.js) and the tab
  froze. It now waits for the new worker to take over, and if the new worker's
  install fails it unregisters the old one before reloading, so you are never
  left on the old build until a hard reload.
