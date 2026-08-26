# Mission Control grouped Overview QA checklist

Record the GNOME Shell version, session type, monitor count, and extension commit before testing.

## Covered by automated tests

Run:

```sh
npm test
nix flake check
```

- [x] One application receives the full outer region; one-window and many-window cases produce valid slots.
- [x] Multiple applications receive distinct coherent regions with sublinear window-count weighting and deterministic spatial placement.
- [x] Same-application windows are grouped even when spatially separated; unmatched windows receive separate fallback groups.
- [x] Window slots stay inside their application region and the overall area, preserve aspect ratio, and flatten in group-contiguous order.
- [x] The owned patch installs and restores cleanly, preserves a later foreign patch, fails closed when unsupported, and falls back to stock slots after invalid input.
- [x] GNOME Shell 48–49 resolves the grouped Overview as unsupported and disabled regardless of the stored setting; GNOME 50 and later honors the setting.
- [x] The pinned GNOME 48, 49, and 50 closures expose the required compositor mode, package the extension and compiled schema, and build ShellCheck-clean isolated launchers.
- [x] The launchers remove host display variables from private D-Bus activation and direct extension preferences and test applications to the nested Wayland display.

The Node suite covers the pure layout and lifecycle controller. The Nix checks cover the versioned launcher and package contracts. Neither can load GNOME Shell's `gi://` and `resource:///` production modules and exercise interactive rendering, so the checks below are the production-adapter leg.

## Requires a live GNOME Shell session

Run one launcher at a time from a terminal inside the graphical login session:

```sh
nix run .#gnome-48
nix run .#gnome-49
nix run .#gnome-50
```

The first run may download a multi-gigabyte GNOME closure. Each launcher uses a temporary HOME/XDG profile, private D-Bus and dconf state, and a version-specific GNOME closure. GNOME 49–50 also use a private PipeWire/WirePlumber media graph. The nested compositor connects to the host display, while test applications receive only the nested Wayland display. The host system bus is used when available, but the host Shell does not restart. Close the nested window or press `Ctrl-C` to stop the run.

### Configuration and lifecycle

- [ ] Record the host extension's dconf subtree before each run; after normal exit, confirm it is byte-for-byte unchanged and the temporary profile reported by the launcher no longer exists.
- [ ] Confirm both terminals, Calculator, and extension preferences appear inside the nested compositor and no new test window appears directly in the host session.
- [ ] With `group-overview-by-application=false`, GNOME 50 uses stock Overview geometry and App Exposé still works.
- [ ] Enable the option while Overview is visible; existing workspaces relayout without stale or duplicate previews.
- [ ] Disable the option while Overview is visible; stock geometry returns immediately.
- [ ] Reload and disable the extension while Overview is visible; no Shell error is logged and stock behavior is restored.
- [ ] On GNOME 48 and 49, set the option to `true` with `gsettings`, then open preferences; the switch is insensitive and shown off while the stored value remains unchanged.
- [ ] On GNOME 48 and 49 with the stored value set to either `false` or `true`, verify Overview remains stock and all pre-existing gestures still work.

### Normal Overview entry paths

- [ ] Swipe up from the desktop, press `Super`, and use the hot corner; each path produces the same grouped geometry.
- [ ] Use a customized Overview keyboard shortcut and verify the same geometry.
- [ ] Evaluate `Main.overview.show()` in Looking Glass and verify the same geometry.
- [ ] Enter the app grid or search, then return to the window picker; grouping returns and search remains usable.
- [ ] Confirm normal workspace thumbnails remain stock rather than grouped.

### App Exposé composition

- [ ] Swipe down from the desktop; only the focused application's windows remain and use the available picker area.
- [ ] Reverse direction during the same gesture; all applications return in grouped geometry without stale previews.
- [ ] Test with no focused application and with a focused application that has one window; existing fallback and activation behavior remains.
- [ ] Minimize a current-application window and confirm it remains represented as intended by App Exposé.
- [ ] Swipe up after entering App Exposé and verify the normal grouped state is restored.

### Dynamic windows and interactions

- [ ] While Overview is visible, open, close, resize, minimize, and unminimize windows; affected groups recompute.
- [ ] Move a window between workspaces and drag a preview between workspace thumbnails.
- [ ] Traverse with the keyboard; focus remains usable and visits each application's windows contiguously.
- [ ] Select a window, use its close button, and drag it; standard `WindowPreview` interactions remain functional.
- [ ] Confirm app-grid transitions, search entry, per-window icons, titles, and overlays remain functional.

### Multiple monitors

- [ ] With workspaces on all displays, each monitor groups only the previews represented on that monitor.
- [ ] With workspaces only on the primary display, secondary-monitor previews do not leak into another group or monitor.
- [ ] Move a window between monitors while Overview is visible; both monitor layouts update.
- [ ] Use the same application on two monitors; it receives one independent group per monitor.

### Application identity edge cases

- [ ] Test Firefox, Chrome, or Chromium regular windows and a browser PWA.
- [ ] Test an Electron application and a JetBrains IDE with multiple windows.
- [ ] Test a Flatpak application.
- [ ] Test Wine or XWayland windows when available; unmatched windows must remain separate rather than forming one unknown group.
- [ ] Open attached dialogs or transients; they remain attached to their root preview rather than receiving separate top-level slots.

## Failure evidence

Capture Shell logs with:

```sh
journalctl --user -f -o cat /usr/bin/gnome-shell
```

An unsupported private interface must log a `Grouped Overview is unsupported` warning and retain stock Overview. A layout calculation failure must log that stock slots are being used; it must not terminate the Shell session.
