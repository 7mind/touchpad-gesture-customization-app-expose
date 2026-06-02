# GNOME Shell internals & version-compatibility notes

Reference for contributors. This extension does not just run *on* GNOME
Shell — it reaches into Shell internals (it monkeypatches prototypes,
replaces gesture trackers, and reads private fields). Those internals change
between GNOME versions, so the notes below capture what to read and what
differs.

## Reading the authoritative Shell source

The JavaScript that this extension hooks into ships compiled into a
`gresource` blob, so it generally cannot be grepped from an installed
system. Read the source for the exact version you target straight from
upstream instead:

```
https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/<version>/js/ui/<file>.js
```

For example `.../raw/50.1/js/ui/workspace.js`. Use the tag matching
`gnome-shell --version`; internals differ across point releases. The files
most relevant here are `swipeTracker.js`, `workspace.js`, `workspacesView.js`,
`overviewControls.js`, and `osdWindow.js` / `main.js`.

Local type stubs for the Shell modules we touch live in
`extension/types/gnome-shell/`. When an internal we depend on is missing or
wrong in `@girs`, extend those stubs rather than casting everywhere.

## Supporting multiple GNOME versions

Supported versions are declared in `metadata.json` (`shell-version`). A single
build targets all of them; per-version differences are handled at runtime in
`extension/src/utils/compat.ts` by **feature detection** (probing for the
method/property that exists) rather than parsing a version number — this
tolerates point releases and backports.

Known divergences currently shimmed (GNOME 48 vs 49/50):

| Area | GNOME 48 | GNOME 49/50 |
|---|---|---|
| SwipeTracker gesture handlers | `_beginGesture` / `_updateGesture` / `_endGesture` | `_beginTouchpadGesture` / `_updateTouchpadGesture` / `_endTouchpadGesture` |
| SwipeTracker constructor | no `phase` option | `phase` option (`Clutter.EventPhase`) |
| OSD | `osdWindowManager.show(monitorIndex, icon, label, level)` | `osdWindowManager.showAll(icon, label, level, maxLevel)` |
| Brightness | `org.gnome.SettingsDaemon.Power.Screen` D-Bus proxy | `Main.brightnessManager` |
| Window maximize | `get_maximized() === Meta.MaximizeFlags.BOTH`; `maximize(flags)` / `unmaximize(flags)` | `is_maximized()`; `maximize()` / `unmaximize()` (no-arg) |

When adding support for a new GNOME version, diff the upstream source for the
internals listed above, add a feature-detected branch in `compat.ts`, extend
the type stubs if needed, and add the version to `metadata.json`. Adding a
version string to the manifest without handling the API differences will crash
the extension on that version.

## Multi-monitor overview window model (App Expose)

App Expose (`src/appSpread.ts`) filters the overview down to the focused
app's windows. Understanding the overview's per-monitor structure is required
to filter correctly on multi-monitor setups:

- The overview shows one `Workspace` actor per **(workspace × monitor)**.
- A `Workspace` decides which windows it shows with `_isMyWindow` (requires
  `window.get_monitor() === this.monitorIndex`, and allows
  `this.metaWorkspace === null`) AND `_isOverviewWindow` (the method App
  Expose patches to additionally require app membership).
- A `Workspace` wires its window add/remove via
  `this.metaWorkspace?.connectObject('window-added' / 'window-removed', ...)`
  **and** via `global.display` `window-entered-monitor` /
  `window-left-monitor`.
- With `workspaces-only-on-primary` enabled (the GNOME default), each
  **secondary** monitor's Workspace is constructed as
  `new Workspace(null, monitorIndex, ...)` — `metaWorkspace === null`. It is
  therefore driven **only** by the per-monitor `global.display` signals, not
  by workspace `window-removed`. Any eviction logic that relies on
  `metaWorkspace.emit('window-removed', ...)` will silently skip secondary
  monitors; remove their clones directly from the live Workspace instead
  (`containsMetaWindow()` / `_doRemoveWindow()`), which is what
  `_removeFilteredWorkspaceWindows()` does.
- Enumerating the live Workspaces: `WorkspacesDisplay._workspacesViews` holds
  one entry per monitor. A primary monitor's entry is a `WorkspacesView`
  (Workspaces in `_workspaces`). A secondary monitor's entry is a
  `SecondaryMonitorDisplay`, which nests its container one level deeper in
  `_workspacesView` (an `ExtraWorkspaceView` with a single `_workspace`, or a
  `WorkspacesView` with `_workspaces`). `_getOverviewWorkspaces()` descends
  into both forms.
