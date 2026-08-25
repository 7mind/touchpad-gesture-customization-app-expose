# Mission Control grouped Overview QA checklist

Record the GNOME Shell version, session type, monitor count, and extension commit before testing.

## Covered by automated tests

Run:

```sh
npm test
```

- [x] One application receives the full outer region; one-window and many-window cases produce valid slots.
- [x] Multiple applications receive distinct coherent regions with sublinear window-count weighting and deterministic spatial placement.
- [x] Same-application windows are grouped even when spatially separated; unmatched windows receive separate fallback groups.
- [x] Window slots stay inside their application region and the overall area, preserve aspect ratio, and flatten in group-contiguous order.
- [x] The owned patch installs and restores cleanly, preserves a later foreign patch, fails closed when unsupported, and falls back to stock slots after invalid input.

The Node suite covers the pure layout and lifecycle controller. It cannot load GNOME Shell's `gi://` and `resource:///` production modules or drive a live compositor, so the checks below are the production-adapter leg.

## Requires a live GNOME Shell session

### Configuration and lifecycle

- [ ] With `group-overview-windows-by-application=false`, GNOME 50 uses stock Overview geometry and App Exposé still works.
- [ ] Enable the option while Overview is visible; existing workspaces relayout without stale or duplicate previews.
- [ ] Disable the option while Overview is visible; stock geometry returns immediately.
- [ ] Reload and disable the extension while Overview is visible; no Shell error is logged and stock behavior is restored.
- [ ] On GNOME 48 and 49, leave the option disabled and verify all pre-existing gestures still work.

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
