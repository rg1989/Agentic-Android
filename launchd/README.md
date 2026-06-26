# Run the hub as a managed service (launchd)

Keeps the **glue** (relay + hub) running across logins and restarts it on crash, so the phone can
reach its hub without you starting anything by hand. The **agent** is intentionally *not* part of the
service (swap/run it yourself: `pnpm agent` or `pnpm agent:claude`), and the phone tunnel
(`adb reverse`) is per-session.

This is **not installed automatically.** To install on your Mac:

```sh
# 1. Edit paths in the plist + backbone/service-run.sh if your checkout isn't at
#    /Users/rgv250cc/Documents/Projects/Agentic-Android, or your node path differs (`which node`).
chmod +x backbone/service-run.sh

# 2. Link it into LaunchAgents and load it
cp launchd/com.agenticandroid.hub.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.agenticandroid.hub.plist

# 3. Check it's up
curl -s 127.0.0.1:8123/status
```

To stop / uninstall:

```sh
launchctl unload ~/Library/LaunchAgents/com.agenticandroid.hub.plist
rm ~/Library/LaunchAgents/com.agenticandroid.hub.plist
```

Logs: `.logs/relay.log`, `.logs/hub.log` (the hub also writes `.logs/service.{out,err}.log`).

## ⚠️ macOS caveat: this checkout is under `~/Documents`

Tested on this Mac: `launchctl load`/`unload` register and tear down the job correctly, **but** the job
fails to actually run because macOS **TCC** blocks background (launchd) processes from reading
`~/Documents`, `~/Desktop`, and `~/Downloads`:

```
shell-init: getcwd: cannot access parent directories: Operation not permitted
/bin/bash: …/backbone/service-run.sh: Operation not permitted
```

The plist and `service-run.sh` are correct (they're the same commands you run by hand). To make the
service actually run, do **one** of:

1. **Move the checkout out of a protected folder** — e.g. `~/agentic-android` or
   `~/Library/Application Support/agentic-android` — and update the paths in the plist + script. (Recommended.)
2. **Grant Full Disk Access** to `/bin/bash` (System Settings → Privacy & Security → Full Disk Access).
   Broad and not recommended.

Until then, run the glue in a terminal (`make up`) — everything else in the app works the same.
