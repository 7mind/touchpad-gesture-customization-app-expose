# Mission Control-style application-grouped Overview for GNOME Shell

**Design target:** `7mind/touchpad-gesture-customization-app-expose`  
**Primary Shell target:** GNOME Shell 50.x  
**Document status:** implementation design / developer handoff  
**Prepared:** 2026-08-25 (Europe/Dublin)

## Baseline revisions

This document is grounded in these concrete revisions rather than in generic GNOME Shell behavior:

- Extension fork: [`7mind/touchpad-gesture-customization-app-expose`](https://github.com/7mind/touchpad-gesture-customization-app-expose), current `main` at [`0876e36`](https://github.com/7mind/touchpad-gesture-customization-app-expose/commit/0876e36) from **2026-08-10**. GitHub currently has **no releases** for this fork.
- GNOME Shell: design checked against the [`50.4`](https://github.com/GNOME/gnome-shell/tree/50.4) source tag, released **2026-08-04** (`dcda659`). The GNOME Shell repository's current `main` had commit `1b73dac` on **2026-08-25** when this document was prepared.
- The extension currently declares GNOME Shell **48, 49, and 50** support in [`metadata.json`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/metadata.json#L6-L10). The first implementation of this feature should be made correct on GNOME 50, then compatibility-probed/backported to 49/48 using the repository's existing runtime feature-detection pattern.

---

## 1. Objective

Extend the existing macOS-like gesture model so that the two vertical directions form a coherent pair:

```text
swipe down  -> App Expose: current application's windows only   [already implemented]
swipe up    -> Mission Control: all applications, grouped by app [this design]
```

The important requirement is **not merely sorting windows by application**. The normal Overview should become a hierarchical view in which:

1. an **application is the primary layout object**; and
2. that application's windows are the secondary layout objects inside its region.

Conceptually:

```text
current workspace windows
        |
        v
group by Shell.App
        |
        +-- Firefox  -> [F1, F2, F3, F4]
        +-- IntelliJ -> [I1, I2]
        +-- Terminal -> [T1, T2, T3]
        |
        v
lay out application regions
        |
        v
lay out each application's windows inside its region
        |
        v
flatten back to ordinary GNOME WindowPreview allocations
```

### Critical scope requirement: this is an Overview behavior, not a swipe-up behavior

The grouped layout must be active whenever GNOME shows the normal window-picker Overview, regardless of how it was entered:

- upward touchpad gesture;
- `Super` / Overview keyboard shortcut;
- hot corner;
- Accessibility or other Shell UI entry points;
- `Main.overview.show()` or equivalent programmatic entry;
- transitions back from app grid/search into the window picker.

The touchpad gesture code should **not** be the component that installs the grouped layout. The gesture code only controls navigation between Overview states. The grouped layout is a persistent window-picker policy while the extension is enabled.

---

## 2. Non-goals for the first implementation

Do not make the first patch depend on all Mission Control polish landing at once.

The first useful version does **not** need:

- overlapping/stacked windows inside an app group;
- hover-to-spread animation;
- clickable application containers;
- a custom background card around every group;
- perfect emulation of Apple's exact sizing heuristic;
- a separate application-level keyboard focus model;
- changes to workspace thumbnails.

The first milestone should prove the structural behavior:

> windows from the same application occupy one coherent application region, and those application regions are what the outer Overview layout optimizes.

Preserve standard `WindowPreview` actors and interactions as much as possible.

---

## 3. Existing extension architecture

The fork is already structured in a way that supports this feature cleanly if grouping is kept separate from gesture navigation.

### 3.1 Sub-extension lifecycle

[`extension/extension.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/extension.ts#L23-L80) owns a list of `ISubExtension`s. `_enable()` constructs the relevant components, pushes them into `_extensions`, then invokes `apply()` on all of them at the end ([lines 327+](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/extension.ts#L327-L328)). Disable/reload tears the components down and rebuilds them.

The Overview gesture component is currently created independently at [lines 87-120](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/extension.ts#L87-L120):

```text
TouchpadGestureCustomization
  |
  +-- OverviewRoundTripGestureExtension
  +-- WorkspaceSwitchingExtension
  +-- AltTabGestureExtension
  +-- ...
```

**Recommendation:** add a new persistent `GroupedOverviewExtension` / `ApplicationGroupedOverviewExtension` as another `ISubExtension`. Do not bury this feature inside `OverviewRoundTripGestureExtension`.

That separation expresses the real responsibilities:

```text
OverviewRoundTripGestureExtension
    -> how a gesture navigates Overview states

ApplicationWindowOverview
    -> which windows are visible during App Expose

ApplicationGroupedOverviewExtension   [new]
    -> where normal Overview window previews are laid out
```

This is the central architectural decision in this document.

### 3.2 Existing gesture navigation

[`overviewRoundTrip.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/overviewRoundTrip.ts) already replaces GNOME's Overview swipe tracker with custom trackers while continuing to drive GNOME's own `_gestureBegin`, `_gestureUpdate`, and `_gestureEnd` machinery.

In `APPLICATION_OVERVIEW_ON_DOWN`, direction hysteresis decides whether the transient App Expose filter should be installed. The existing code explicitly distinguishes a downward current-app path from the ordinary Overview path; for example see the App Expose branch around [`_gestureUpdate()`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/overviewRoundTrip.ts#L208-L250) and the corresponding end-state handling around [lines 258-283](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/overviewRoundTrip.ts#L258-L283).

The new grouped Overview should require little or no special-case code here. Upward progress continues to drive the normal GNOME `WINDOW_PICKER` state. The difference is that the window picker's persistent layout policy is now grouped.

### 3.3 Existing App Expose implementation is a good monkeypatch precedent

[`ApplicationWindowOverview` in `appSpread.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/appSpread.ts) already demonstrates the repository's established technique for modifying Shell internals safely enough for this project:

- it saves and overrides private/prototype behavior;
- it restores the original methods on exit;
- it mutates every live Overview `Workspace` actor when necessary;
- it handles primary and secondary monitor actor shapes;
- it works around GNOME's `WorkspaceLayout` freeze behavior so touchpad-driven transitions relayout immediately.

In particular:

- `_patchWindowFiltering()` overrides `Workspace.prototype._isOverviewWindow` and `WorkspaceThumbnail.prototype._isOverviewWindow` ([lines 135-167](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/appSpread.ts#L135-L167)).
- `_getOverviewWorkspaces()` explicitly walks `Main.overview._overview._controls._workspacesDisplay._workspacesViews` and handles both primary and nested secondary-monitor view shapes ([lines 233-255](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/appSpread.ts#L233-L255)).
- after changing window membership, it unfreezes workspace layouts so the gesture can animate the new geometry instead of waiting for GNOME's pointer-based reposition delay (the `show()` sequence calls `_unfreezeWorkspaceLayouts()` before continuing; see [lines 62-83](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/appSpread.ts#L62-L83)).

The grouped Overview should reuse and generalize these patterns rather than inventing a second way to find/invalidate live Overview workspaces.

### 3.4 Existing version-compatibility policy

[`docs/gnome_shell_internals.md`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/docs/gnome_shell_internals.md#L197-L211) already says the extension intentionally reaches into private Shell internals and should:

- read source matching the exact Shell version;
- extend local Shell type stubs rather than scattering casts;
- handle version differences with runtime **feature detection**, not version-number parsing.

[`src/utils/compat.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/utils/compat.ts) is the implementation precedent. The grouped Overview should follow the same policy.

---

## 4. The GNOME Shell seam to override

On GNOME Shell 50.4, the normal window picker is fundamentally a **flat window layout**.

The relevant source is [`js/ui/workspace.js`](https://github.com/GNOME/gnome-shell/blob/50.4/js/ui/workspace.js).

### 4.1 Stock layout path

`WorkspaceLayout._createBestLayout(area)` creates an `UnalignedLayoutStrategy`, then repeatedly calls it with the flat `_sortedWindows` list while trying different row counts ([GNOME 50.4 source](https://github.com/GNOME/gnome-shell/blob/50.4/js/ui/workspace.js#L475-L511)).

Conceptually:

```text
WorkspaceLayout._sortedWindows: WindowPreview[]
        |
        v
UnalignedLayoutStrategy.computeLayout(allWindows)
        |
        v
_getWindowSlots(...)
        |
        v
[x, y, width, height, WindowPreview][]
```

There is no application-level object in that pipeline.

### 4.2 Preserve `vfunc_allocate()`

Do **not** start by replacing `WorkspaceLayout.vfunc_allocate()`.

Reasons:

1. it is a GObject layout-manager vfunc, so it is a higher-risk monkeypatch target than ordinary helper methods;
2. the stock allocator already implements important animation, clipping, minimized-window, and transition behavior we want to keep;
3. it dynamically calls `_createBestLayout()` and `_getWindowSlots()`, which are enough seams for supplying different target geometry.

Most importantly, stock GNOME already interpolates each window between its real desktop geometry and its target Overview slot. In 50.4, `vfunc_allocate()` gets the window's `boundingBox`, calculates the floating desktop box, then `Util.lerp()`s position and size toward the target slot using the Overview state adjustment ([GNOME 50.4 source around the interpolation](https://github.com/GNOME/gnome-shell/blob/50.4/js/ui/workspace.js#L653-L708)).

This means:

> If the extension changes the **target slots**, GNOME's existing animation machinery makes each window fly from its real desktop position to the correct application group during swipe-up, `Super`, hot-corner entry, and every other ordinary Overview transition.

No gesture-specific animation engine is required.

### 4.3 Preferred patch surface

Start with an override of:

```text
WorkspaceLayout.prototype._createBestLayout
```

and, only if the custom strategy cannot satisfy the existing contract cleanly:

```text
WorkspaceLayout.prototype._getWindowSlots
```

The ideal implementation patches `_createBestLayout()` to install a custom strategy in `this._layoutStrategy`, while leaving the stock `_getWindowSlots()` and `vfunc_allocate()` intact.

A rough shape:

```ts
const originalCreateBestLayout = WorkspaceLayout.prototype._createBestLayout;

WorkspaceLayout.prototype._createBestLayout = function (area) {
    this._layoutStrategy = new ApplicationGroupedLayoutStrategy({
        monitor: Main.layoutManager.monitors[this._monitorIndex],
        // spacing / app resolver / other dependencies
    });

    return this._layoutStrategy.computeBestLayout(
        this._sortedWindows,
        area
    );
};
```

The exact method names of the new strategy are extension-owned; it only needs to produce whatever `_getWindowSlots()` expects, or provide a compatible `computeWindowSlots()` implementation.

### 4.4 Why this also fixes regular Overview

A prototype-level layout patch is installed when the extension is enabled, **not when a gesture begins**. Every existing or future `WorkspaceLayout` instance therefore resolves its ordinary method call through the patched prototype.

That is what guarantees parity across:

```text
swipe up ---------+
Super ------------+
hot corner -------+--> same WorkspaceLayout --> same grouped target slots
programmatic show-+
```

This is the behavior missing from a gesture-only implementation.

---

## 5. Proposed component architecture

### 5.1 New components

Recommended file-level structure:

```text
extension/src/
  groupedOverview.ts            lifecycle + GNOME monkeypatch integration
  groupedOverviewLayout.ts      pure-ish hierarchical layout algorithm
  overviewInternals.ts          shared enumeration/invalidation helpers
  appGroupChrome.ts             optional phase-2 application labels/cards
```

Existing files remain responsible for their current jobs:

```text
overviewRoundTrip.ts             gesture navigation state machine
appSpread.ts                     transient current-app visibility filter
appOverviewWindowFilter.ts       pure App Expose filtering predicate
```

### 5.2 `GroupedOverviewExtension`

Responsibilities:

- feature-detect required `WorkspaceLayout` internals;
- save the original prototype methods;
- install grouped layout wrappers;
- invalidate all currently live Overview workspace layouts after patching;
- restore originals on `destroy()`;
- invalidate live layouts again so disabling the extension visibly returns to stock layout;
- optionally own app-group chrome controllers later.

It should **not**:

- create or own touchpad trackers;
- decide whether a gesture was upward/downward;
- filter current-app windows;
- patch workspace thumbnails for normal Overview.

### 5.3 Extract shared Overview internals

`appSpread.ts` currently contains private types and the only robust implementation for enumerating live Overview workspaces across monitors. Extract that into a shared module such as `overviewInternals.ts`:

```ts
export type OverviewWorkspace = { ... };

export function getOverviewWorkspaces(): OverviewWorkspace[];

export function unfreezeWorkspaceLayout(workspace: OverviewWorkspace): void;

export function invalidateWorkspaceLayout(
    workspace: OverviewWorkspace,
    options?: { unfreeze?: boolean }
): void;
```

`invalidateWorkspaceLayout()` should make the layout recompute on the next allocation, for example by doing the equivalent of:

```text
layout._needsLayout = true
layout.layout_frozen = false   // where appropriate
layout.layout_changed()
```

Use feature checks around private fields/methods; do not assume all three supported GNOME majors expose exactly the same shape.

`ApplicationWindowOverview` can then reuse those functions instead of keeping a private copy of the monitor traversal and unfreeze logic.

---

## 6. Data model: application groups are virtual layout nodes

The extension should keep GNOME's actual actor hierarchy flat.

**Do not reparent `WindowPreview` actors into application containers.**

GNOME attaches a lot of behavior to those preview actors and their current parent/layout relationship:

- selection;
- close UI;
- keyboard focus;
- dragging between workspaces;
- Overview window drag callbacks;
- transient dialogs;
- stacking;
- allocation transitions.

Instead, create **virtual application groups used only by the geometry calculation**.

Suggested types:

```ts
type WindowPreviewLike = {
    metaWindow: Meta.Window;
    boundingBox: Meta.Rectangle;
    // plus the small subset required by the copied/adapted layout algorithm
};

type AppIdentity =
    | {kind: 'shell-app'; app: Shell.App; key: string}
    | {kind: 'unmatched-window'; window: Meta.Window; key: string};

interface ApplicationGroup {
    identity: AppIdentity;
    app: Shell.App | null;
    windows: WindowPreviewLike[];

    // Position of the group on the real desktop, used to preserve spatial memory.
    anchorX: number;
    anchorY: number;

    // Intrinsic/desired footprint used by the outer layout.
    preferredWidth: number;
    preferredHeight: number;
    weight: number;
}
```

The final output is still the ordinary flat slot list GNOME understands:

```ts
type WindowSlot = [
    x: number,
    y: number,
    width: number,
    height: number,
    preview: WindowPreviewLike,
];
```

The hierarchy exists in the **calculation**, not in the Clutter actor tree.

---

## 7. Canonical application identity

Use GNOME Shell's own application association.

The existing extension already uses `Shell.WindowTracker.get_default()` in `OverviewRoundTripGestureExtension`; the grouped layout should use:

```ts
const tracker = Shell.WindowTracker.get_default();
const app = tracker.get_window_app(metaWindow);
```

This is preferable to inventing grouping from `WM_CLASS`, title prefixes, process IDs, etc. `Shell.WindowTracker` is the same subsystem GNOME uses to associate windows with `Shell.App` instances.

### Fallback

Be defensive if `get_window_app()` returns `null`/no usable application:

- create a unique one-window fallback group for that `Meta.Window`;
- do **not** merge all unknown windows into a single giant "unknown app" group.

### Test application-identity edge cases

Manually validate at least:

- Firefox/Chrome/Chromium regular windows;
- browser PWAs;
- Electron apps;
- JetBrains IDE windows;
- Flatpak applications;
- Wine/XWayland applications if relevant;
- dialogs/transients.

For dialogs, GNOME's `Workspace` normally attaches transients to the root `WindowPreview` rather than giving each transient its own top-level slot. Group the top-level preview by its root `Meta.Window`; do not create separate app groups for attached dialog actors.

---

## 8. Hierarchical layout algorithm

### 8.1 Do not implement this as a flat sort

This is insufficient:

```text
Firefox F1
Firefox F2
Firefox F3
IntelliJ I1
IntelliJ I2
Terminal T1
```

A flat layout engine can still put those windows in visually unrelated rows/areas while optimizing scale. The design target is perceptual hierarchy:

```text
there are three primary things on this screen:
Firefox, IntelliJ, Terminal
```

Each application's windows must be constrained to a coherent region chosen by an **outer** application layout.

### 8.2 Recommended abstraction: make the row-layout algorithm generic

GNOME 50's `UnalignedLayoutStrategy` is private/unexported. Rather than trying to instantiate it from the extension, adapt the relevant algorithm into an extension-owned pure TypeScript layout primitive.

A useful abstraction is:

```ts
interface LayoutItem {
    id: string;
    sourceCenterX: number;
    sourceCenterY: number;
    intrinsicWidth: number;
    intrinsicHeight: number;
}

class SpatialRowLayout<T extends LayoutItem> {
    compute(items: T[], area: Rectangle): ItemSlot<T>[];
}
```

Then use the same primitive twice:

```text
SpatialRowLayout<ApplicationGroup>
    -> application rectangles

SpatialRowLayout<WindowPreviewItem>
    -> window rectangles inside each application rectangle
```

This preserves the useful stock-GNOME idea of spatial ordering while giving the extension a hierarchy.

If substantial GNOME layout code is copied/adapted, retain attribution and confirm licensing. The repository root currently contains GPL-3.0 text while `package.json` says `LGPL-3.0-or-later`; that existing inconsistency should be resolved before importing a large GPL-derived implementation.

### 8.3 Step 1: group windows

Input:

```text
WorkspaceLayout._sortedWindows
```

Resolve each preview's `Meta.Window`, map to `Shell.App`, and build `ApplicationGroup[]`.

Preserve a deterministic group order. A good baseline is the minimum stable sequence of any window in the group, while placement is still influenced by spatial anchors.

### 8.4 Step 2: calculate a group anchor

For each app group, calculate where it "comes from" on the real desktop.

Use the member windows' real `boundingBox` centers. Good candidates:

- area-weighted mean center; or
- center of the union of all member bounding boxes.

The anchor exists so the outer layout can preserve spatial memory similarly to stock GNOME: an app whose windows live on the left should generally remain left of an app whose windows live on the right.

### 8.5 Step 3: calculate a desired app-group footprint

Do not give every application an equal rectangle, and do not scale group size linearly with window count.

For example:

```text
Firefox:    7 windows
Terminal:   2 windows
Calculator: 1 window
```

Equal thirds waste space, while strict proportional area lets Firefox dominate.

Start with a sublinear count heuristic such as:

```ts
weight = 1 + GROUP_COUNT_FACTOR * (Math.sqrt(windowCount) - 1);
```

or derive a preferred footprint from the member windows' aggregate intrinsic geometry and damp the result with `sqrt`/log scaling.

The exact constants are tuning parameters; the architectural rule is **sublinear growth**.

### 8.6 Step 4: outer application layout

Lay out the `ApplicationGroup` virtual nodes across the available Overview work area.

The outer objective should prefer:

1. large usable scale;
2. low wasted area;
3. spatial ordering close to source app anchors;
4. enough padding between application regions to make grouping visually obvious.

A modified version of GNOME's row search is a good starting point: try candidate row counts, compute resulting scale/space, and choose the best.

### 8.7 Step 5: inner window layout

For each app rectangle:

1. subtract app-group padding/chrome reservation;
2. lay out only that group's member windows inside the remaining rectangle;
3. preserve window aspect ratio;
4. preserve their relative spatial order when practical;
5. return ordinary `WindowPreview` target allocations.

### 8.8 Step 6: flatten to GNOME slots

Flatten the per-group window slots in **group-contiguous order**:

```text
Firefox slots...
IntelliJ slots...
Terminal slots...
```

That matters because stock `WorkspaceLayout.getFocusChain()` returns the fifth element of each `_windowSlots` tuple in slot order. If the final slot order is grouped, keyboard focus traversal automatically becomes group-contiguous without replacing `getFocusChain()`.

### 8.9 Single-group special case

If only one app group is present, the **outer layout should effectively disappear**: give the app the whole available window-picker area and run only the inner window layout.

This is particularly important because the existing swipe-down App Expose filter leaves exactly one application's windows visible. The same grouped layout engine can therefore serve App Expose without making the current app needlessly small inside a one-cell outer grid.

### 8.10 One-window application special case

Do not shrink a single window merely to make it look like a "group". A one-window app is still an app group, but its only preview should use the available group region efficiently.

The hierarchy should become visually unobtrusive when a group contains one window.

---

## 9. Interaction with the existing swipe-down App Expose

The two features should compose naturally rather than toggle each other.

Current App Expose does approximately:

```text
normal Overview Workspace windows
        |
ApplicationWindowOverview.show(app)
        |
filter/rebuild clones so only app.get_windows() remain
        |
WorkspaceLayout relayout
```

With persistent grouped Overview installed, that becomes:

```text
normal Overview
  -> N application groups

swipe down / App Expose filter
  -> one application's previews remain
  -> grouped strategy sees exactly one group
  -> single-group path fills the available area

restoreDefaultOverview()
  -> all normal previews restored
  -> grouped strategy sees N groups again
```

No direction-specific grouping state should be required in `overviewRoundTrip.ts`.

### Existing relayout workaround remains relevant

`ApplicationWindowOverview` currently unfreezes workspace layouts after installing/removing filtered previews because GNOME deliberately freezes layout for a period after removals to avoid windows moving under a mouse pointer. This remains necessary for touchpad App Expose transitions.

The grouped layout extension should **reuse** the same shared invalidation/unfreeze utility; it should not remove that workaround.

### Optional later integration

Once application group chrome exists, clicking an application label/icon could call the same `ApplicationWindowOverview.show(app)` behavior while already inside normal Overview. That would produce a Mission Control-like "drill into this application" interaction and reuse code that already exists.

This is useful, but it should not block the layout MVP.

---

## 10. Application chrome: phase 2, not part of the slot list

To make "app is the main Overview element" fully legible, eventually add one label/icon (and optionally a subtle card/background) per application group.

However, do **not** put application chrome actors into `WorkspaceLayout._windowSlots`.

Stock `vfunc_allocate()` assumes every slot child is a registered window preview and immediately looks it up in `this._windows` to retrieve its `metaWindow`. A non-window actor in the slot array would violate that contract and force a much more invasive allocator override.

### Recommended actor model

Keep:

```text
Workspace
  +-- background
  +-- _container                stock window-preview container
      +-- WindowPreview
      +-- WindowPreview
      +-- WindowPreview
```

and add an extension-owned sibling overlay:

```text
Workspace
  +-- background
  +-- _container                stock WindowPreview actors, unchanged
  +-- appGroupOverlay           extension-owned, non-reactive initially
      +-- Firefox label/icon
      +-- IntelliJ label/icon
      +-- Terminal label/icon
```

Use a `WeakMap<WorkspaceLayout, AppGroupChromeController>` or equivalent to associate computed group rectangles with their owning live workspace.

The chrome controller receives group rectangles from the layout computation and positions its overlay actors accordingly.

### Chrome state

At first:

- make group chrome non-reactive;
- show it only around `WINDOW_PICKER` state;
- fade it with the same Overview state adjustment so it does not appear abruptly during swipe-up;
- suppress/reduce redundant group chrome for the one-group App Expose state if desired.

Only after geometry and transitions are stable should group chrome become clickable/hover-reactive.

---

## 11. Regular Overview lifecycle and live-layout invalidation

Because the patch is persistent, applying or removing it while live Overview actors already exist needs an explicit relayout.

### `apply()`

Pseudo-flow:

```ts
apply() {
    if (!this.supported)
        return;

    this._saveOriginalMethods();
    this._installWorkspaceLayoutPatch();

    for (const workspace of getOverviewWorkspaces())
        invalidateWorkspaceLayout(workspace, {unfreeze: true});
}
```

### `destroy()`

Pseudo-flow:

```ts
destroy() {
    this._destroyGroupChrome();
    this._restoreWorkspaceLayoutPatch();

    for (const workspace of getOverviewWorkspaces())
        invalidateWorkspaceLayout(workspace, {unfreeze: true});
}
```

After disable, an already-visible Overview should visibly settle back to stock GNOME geometry rather than retaining stale grouped slots until some unrelated window event.

### Monkeypatch ownership

Be careful not to clobber another extension that patched the same method after this extension did.

A safer restore rule is:

```text
restore original only if WorkspaceLayout.prototype._createBestLayout
is still exactly our installed wrapper
```

If it is no longer ours, log that another extension replaced the method and avoid overwriting its patch during teardown.

Conflict with extensions such as V-Shell or Native Window Placement is expected because they target the same conceptual seam. Fail predictably rather than silently fighting for the prototype.

---

## 12. Multiple monitors

GNOME creates Overview `Workspace` actors per workspace/monitor view. The fork has already encountered the important secondary-monitor edge case and documents it in [`gnome_shell_internals.md`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/docs/gnome_shell_internals.md).

For grouped Overview, this model is actually convenient:

- each `WorkspaceLayout` only sees the previews belonging to that monitor/workspace actor;
- group **within each layout**, not globally across monitors;
- the same application may therefore have one group on monitor A and another on monitor B, containing the windows physically represented on each monitor.

That matches the visual mental model better than creating one cross-monitor group.

Do not derive group membership from `Shell.App.get_windows()` and then blindly include every app window. The layout should group the previews already present in that specific `WorkspaceLayout._sortedWindows` list. The `Shell.App` is the **key**, not the source of global membership.

For group chrome and live invalidation, reuse the fork's existing primary/secondary traversal helper after extracting it from `appSpread.ts`.

---

## 13. Window lifecycle and behavior that should stay stock

A major advantage of virtual groups is that most GNOME behavior does not need new code.

### Window open/close/resize

GNOME `WorkspaceLayout.addWindow()` and `removeWindow()` already update `_sortedWindows`, set `_needsLayout`, and queue layout. Size changes also mark the layout dirty. The custom `_createBestLayout()` will simply see the new flat preview set and regroup it.

### Minimized windows

The fork's latest commit specifically fixes minimized windows in App Expose. Normal GNOME allocation also has explicit behavior for windows not currently `showing_on_its_workspace()`, giving them a zero-sized floating start before interpolation.

Do not filter minimized previews out in the grouped algorithm. Group whatever valid top-level `WindowPreview`s the live `WorkspaceLayout` currently owns.

### Drag and drop

Leave each `WindowPreview` under GNOME's normal `_container`. Existing drag signals and `Main.overview.beginWindowDrag()` / `endWindowDrag()` behavior then remain intact.

### Close buttons and window overlays

Keep existing per-window overlay/chrome for the MVP. Hiding/replacing duplicate app icons is polish and may change spacing calculations; postpone it until group geometry is stable.

### Workspace thumbnails

Do **not** apply normal application grouping to `WorkspaceThumbnail`.

Mission Control/Spaces thumbnails represent workspace contents, not an exposé layout. Keeping stock thumbnails also avoids another private layout override.

The existing App Expose code may continue filtering thumbnails during its transient current-app mode because that is a separate behavior already implemented by the fork.

---

## 14. Search and app-grid transitions

The grouped layout is specifically the **window-picker** presentation.

GNOME's Overview state adjustment transitions among:

```text
HIDDEN -> WINDOW_PICKER -> APP_GRID
```

The persistent window-layout patch can remain installed in all states; it only determines the window picker's target geometry.

If application group chrome is added:

- drive its opacity/visibility from Overview/window-picker state;
- avoid showing labels over the app grid;
- avoid making group chrome capture input while search/app grid owns the view;
- preserve the existing App Expose behavior that disables search while filtered current-app mode is active.

No special entry-point detection should be required.

---

## 15. Settings model

Current `OverviewNavigationState` values are:

```ts
CYCLIC
GNOME
WINDOW_PICKER_ONLY
APPLICATION_OVERVIEW_ON_DOWN
```

([`common/settings.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/common/settings.ts#L20-L25)).

Application grouping is **orthogonal** to that navigation state. Do not encode it as another navigation-state enum value if avoidable.

Preferred setting:

```text
group-overview-by-application: boolean
```

or, if future layout modes are likely:

```text
overview-window-layout: STOCK | GROUPED_BY_APPLICATION
```

This lets a user independently choose:

```text
APPLICATION_OVERVIEW_ON_DOWN + GROUPED_BY_APPLICATION
```

which is the intended macOS-like pairing, without making the App Expose gesture mode responsible for normal Overview visuals.

Update:

- `extension/common/settings.ts` key unions and typed accessors;
- GSettings schema;
- preferences UI;
- README behavior description.

For a first private prototype, hard-wiring grouped layout when `APPLICATION_OVERVIEW_ON_DOWN` is selected is acceptable, but the implementation should still be a separate sub-extension so that extracting a setting later is trivial.

---

## 16. TypeScript and Shell-internal types

The project builds in strict TypeScript mode and already maintains Shell-internal compatibility notes.

Add local types for the specific private surface rather than casting the whole layout manager to `any`.

For example:

```ts
interface GroupableWorkspaceLayout {
    _monitorIndex: number;
    _sortedWindows: WindowPreviewLike[];
    _needsLayout: boolean;
    _layoutStrategy: unknown;
    layout_frozen: boolean;
    layout_changed(): void;
    _createBestLayout(area: RectangleLike): unknown;
    _getWindowSlots(box: Clutter.ActorBox): WindowSlot[];
}
```

If the existing `extension/types/gnome-shell/` tree lacks a `workspace.d.ts`, add one or augment the module declaration for `resource:///org/gnome/shell/ui/workspace.js`.

Feature-detect the runtime methods as the repository already does elsewhere:

```ts
const proto = WorkspaceLayout.prototype as unknown as Partial<GroupableWorkspaceLayout>;

const supported =
    typeof proto._createBestLayout === 'function' &&
    typeof proto._getWindowSlots === 'function';
```

If unsupported, log a clear warning and leave the stock Overview intact. A private-API mismatch must not break the GNOME session.

---

## 17. Testing strategy

The existing `npm test` currently compiles TypeScript and runs a small pure Node test for `appOverviewWindowFilter` ([`package.json`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/package.json#L18-L29)). Extend that pattern.

The layout algorithm should be mostly pure TypeScript so it can be tested without a GNOME session.

### Unit-test the pure hierarchy

Suggested cases:

1. **one app, one window** -> one group, efficient full-area use;
2. **one app, many windows** -> all windows remain inside one group region;
3. **many apps, one window each** -> behaves like a spatial application layout;
4. **mixed counts** -> larger groups get more space, but sublinearly;
5. **same app windows separated on desktop** -> still one group;
6. **unknown app identity** -> one fallback group per unknown window;
7. **determinism** -> same input produces same group/slot order;
8. **bounds** -> no slot escapes its group or overall area;
9. **aspect ratio** -> output scaling preserves each window's aspect within tolerance;
10. **group-contiguous flat slot order** -> focus chain will traverse group members together.

Consider making the Node test entry run multiple files instead of hardcoding only `appOverviewWindowFilter.test.js`.

### Manual Shell acceptance matrix

Test all of these on GNOME 50 before calling the feature complete:

#### Entry paths

- swipe up from desktop;
- `Super` from desktop;
- hot corner;
- Overview keyboard shortcut if customized;
- leave app grid back to window picker;
- programmatic `Main.overview.show()` from Looking Glass if practical.

Every path must converge on the same grouped geometry.

#### Existing App Expose gesture

- swipe down from desktop -> current app only;
- reverse direction during the same gesture -> restore grouped normal Overview;
- swipe up after having entered App Expose -> correct state/geometry;
- no focused app -> existing fallback behavior remains;
- one-window current app -> existing activation/hide behavior remains;
- minimized current-app windows remain visible as intended by the fork.

#### Dynamic windows

- open a window while Overview is visible;
- close a window while Overview is visible;
- resize a window;
- minimize/unminimize;
- move window between workspaces;
- move window between monitors;
- drag a preview between workspaces from Overview.

#### Multi-monitor

Test both:

- workspaces on all displays;
- workspaces only on primary.

Specifically retest the secondary-monitor leakage class of bugs already fixed in this fork.

#### Interaction

- keyboard focus traversal;
- selecting a window;
- close button;
- dragging;
- search entry;
- app-grid transition;
- disabling/reloading the extension while Overview is visible.

---

## 18. Implementation sequence

The safest development path is incremental.

### Phase 0 - refactor shared Overview internals

Before changing geometry:

1. extract `getOverviewWorkspaces()` and unfreeze/invalidate logic from `appSpread.ts` into `overviewInternals.ts`;
2. keep App Expose behavior identical;
3. verify the current test/manual behavior.

This gives the new feature a reusable lifecycle seam and reduces duplicated private-Shell knowledge.

### Phase 1 - pure grouping/layout library

Implement `groupedOverviewLayout.ts` with no GNOME actor creation.

Inputs should be simple records representing window geometry and app identity. Outputs should be application rectangles plus flat window slots.

Add Node tests before monkeypatching Shell.

### Phase 2 - persistent layout monkeypatch, no app chrome

Create `GroupedOverviewExtension`:

1. feature-detect `WorkspaceLayout` hooks;
2. patch `_createBestLayout()` and only patch `_getWindowSlots()` if the strategy contract requires it;
3. invalidate live workspaces;
4. restore on destroy;
5. wire as a separate `ISubExtension` in `extension.ts`.

At this point, keep standard per-window icons/titles. The success criterion is purely geometric grouping.

### Phase 3 - validate every Overview entry path

Do not proceed until:

```text
swipe up == Super == hot corner == programmatic normal Overview
```

in terms of grouping.

This phase specifically catches the failure mode where grouping accidentally lives in `OverviewRoundTripGestureExtension` rather than the global layout policy.

### Phase 4 - integrate/retest App Expose

Make the single-group case produce a good App Expose layout and verify direction reversal.

Ideally no new gesture logic is needed; only geometry tuning should be necessary.

### Phase 5 - application group chrome

Add one app icon/name per region using an overlay sibling, never by reparenting window previews or inserting non-window actors into `_windowSlots`.

Tie chrome to Overview state adjustment and make it non-reactive initially.

### Phase 6 - optional Mission Control polish

After the base feature is robust, consider:

- hover a group -> increase spacing between its windows;
- click app label/icon -> invoke `ApplicationWindowOverview.show(app)`;
- subtle group background/card;
- group-level highlight during keyboard navigation;
- hide redundant per-window app icons while preserving titles/close controls;
- tuned macOS-like group weighting and overlap.

---

## 19. Performance considerations

The stock Overview already performs a search over candidate row counts for windows. A hierarchical algorithm adds an outer layout plus inner layouts, but normal desktop window counts are small enough that simple `O(n^2)` candidate scoring is usually acceptable.

Still:

- group once per `_createBestLayout()` call, not once per animation frame;
- keep `Shell.WindowTracker` lookup results local to the layout computation;
- do not create/destroy app chrome actors on every adjustment-value update;
- use stable group keys so chrome actors can be reused across relayouts;
- preserve GNOME's `_needsLayout` caching and layout freeze behavior rather than forcing continuous recomputation during every gesture update.

The stock allocator interpolates cached target slots during the gesture. That is exactly what we want: **calculate grouped targets when layout changes, then let the state adjustment animate toward them cheaply.**

---

## 20. Failure/compatibility risks

### Private Shell API drift

This extension already accepts that risk. Keep the new private surface small and feature-detected.

Most likely fragile fields/methods:

- `WorkspaceLayout._sortedWindows`;
- `WorkspaceLayout._layoutStrategy`;
- `_createBestLayout()` / `_getWindowSlots()` signatures;
- `WindowPreview` geometry/chrome methods;
- `Main.overview._overview._controls...` path used for live-workspace enumeration.

### Competing Overview extensions

V-Shell, Native Window Placement, and similar extensions may patch the same layout methods. Detect method replacement where practical and log an explicit compatibility warning.

### Layout freeze

A relayout after filtering/removing windows may remain frozen by GNOME's pointer-oriented delay. Reuse the existing fork workaround, especially for direction changes mid-touchpad gesture.

### Application identity surprises

Use `Shell.WindowTracker`, but maintain a safe one-window fallback for unmatched windows.

### Group chrome geometry

This is the main reason to defer chrome. It must track the same workspace/container transforms as the previews without becoming another participant in `WorkspaceLayout`'s window-only slot contract.

---

## 21. Recommended concrete first patch

A developer picking this up should aim for the smallest vertical slice that proves the architecture:

1. Extract `getOverviewWorkspaces()` + `invalidateWorkspaceLayout()`.
2. Add a boolean `group-overview-by-application` setting (or temporarily hard-wire it for `APPLICATION_OVERVIEW_ON_DOWN`).
3. Add `GroupedOverviewExtension` as a separate `ISubExtension` in `extension.ts`.
4. Patch `WorkspaceLayout.prototype._createBestLayout` globally while enabled.
5. Implement a simple two-level spatial grid/row layout in pure TypeScript:
   - `Shell.WindowTracker.get_window_app(metaWindow)` for keys;
   - outer groups arranged spatially;
   - inner windows arranged spatially;
   - one-group fast path;
   - flat group-contiguous slot output.
6. Leave all existing `WindowPreview` actors and per-window chrome untouched.
7. Verify that **`Super` is grouped before touching the swipe code**. If `Super` is not grouped, the patch is at the wrong architectural level.
8. Verify swipe-up now gets the grouped layout automatically.
9. Verify swipe-down App Expose still filters to one app and the same layout naturally fills the area.
10. Only then add application-level icon/name chrome.

That gives a clear implementation invariant:

> The gesture system chooses *which Overview state is visible*. The workspace layout system chooses *how normal Overview windows are organized*. Application grouping belongs entirely to the latter.

---

## 22. Acceptance criteria

The feature is done when all of the following are true:

- [ ] Normal Overview treats applications as outer layout units.
- [ ] All top-level windows belonging to one `Shell.App` stay inside one coherent group region.
- [ ] Groups are laid out independently of the windows inside other groups.
- [ ] A one-window app uses its group space efficiently.
- [ ] A one-app view uses the full window-picker area.
- [ ] Swipe-up enters grouped Overview.
- [ ] Pressing `Super` enters the **same** grouped Overview.
- [ ] Hot-corner/programmatic entry enters the same grouped Overview.
- [ ] Swipe-down still enters current-application App Expose.
- [ ] Reversing the App Expose gesture restores grouped all-app Overview without stale/duplicate previews.
- [ ] Opening/closing/resizing/minimizing windows recomputes groups correctly.
- [ ] Dragging individual windows between workspaces still works.
- [ ] Keyboard focus remains usable and group-contiguous.
- [ ] Multi-monitor layouts group independently per monitor and do not leak windows.
- [ ] Workspace thumbnails stay stock in normal Overview.
- [ ] Search/app-grid transitions remain usable.
- [ ] Disabling/reloading the extension restores stock `WorkspaceLayout` behavior cleanly.
- [ ] Unsupported Shell internals fail closed to stock Overview rather than breaking the session.

---

## 23. Source map and references

All links below were checked **2026-08-25, Europe/Dublin**.

### Extension fork

Repository: [`7mind/touchpad-gesture-customization-app-expose`](https://github.com/7mind/touchpad-gesture-customization-app-expose)  
Last commit checked: [`0876e36`, 2026-08-10](https://github.com/7mind/touchpad-gesture-customization-app-expose/commit/0876e36)  
Latest GitHub release: **none** as of 2026-08-25 ([releases page](https://github.com/7mind/touchpad-gesture-customization-app-expose/releases))

Key files at the baseline commit:

- [`extension/extension.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/extension.ts) - sub-extension construction/lifecycle and Overview gesture registration.
- [`extension/src/overviewRoundTrip.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/overviewRoundTrip.ts) - custom Overview swipe state machine and App Expose direction handling.
- [`extension/src/appSpread.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/appSpread.ts) - current-app filter, live Workspace mutation, multi-monitor traversal, layout-unfreeze behavior.
- [`extension/src/appOverviewWindowFilter.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/appOverviewWindowFilter.ts) - pure current-app filtering predicate.
- [`extension/src/utils/compat.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/src/utils/compat.ts) - runtime feature-detection precedent.
- [`extension/common/settings.ts`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/extension/common/settings.ts) - typed setting keys and `OverviewNavigationState`.
- [`docs/gnome_shell_internals.md`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/docs/gnome_shell_internals.md) - project-specific Shell internals and secondary-monitor notes.
- [`package.json`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/package.json) - build/test entry points and GNOME 50 type dependency.
- [`metadata.json`](https://github.com/7mind/touchpad-gesture-customization-app-expose/blob/0876e36/metadata.json) - declared Shell 48/49/50 support.

### GNOME Shell

Repository: [`GNOME/gnome-shell`](https://github.com/GNOME/gnome-shell) (read-only GitHub mirror of GNOME GitLab)  
Repository `main` latest commit checked: [`1b73dac`, 2026-08-25](https://github.com/GNOME/gnome-shell/commit/1b73dac)  
Latest stable 50.x release checked: [`50.4`, 2026-08-04, tag commit `dcda659`](https://github.com/GNOME/gnome-shell/releases/tag/50.4)

Primary implementation reference:

- [`GNOME Shell 50.4 js/ui/workspace.js`](https://github.com/GNOME/gnome-shell/blob/50.4/js/ui/workspace.js)
  - stock `_createBestLayout()` and flat `_sortedWindows` strategy: around lines 475-511;
  - stock `_getWindowSlots()` immediately after it;
  - `vfunc_allocate()` target-slot interpolation and allocation: around lines 580-711;
  - `getFocusChain()` uses `_windowSlots` order;
  - `addWindow()`/`removeWindow()` dirty and refresh the layout;
  - `Workspace` creates one `WorkspaceLayout` for each live workspace/monitor actor and adds ordinary `WindowPreview`s to it.

API references:

- [`Shell.WindowTracker`](https://gnome.pages.gitlab.gnome.org/gnome-shell/shell/class.WindowTracker.html) - canonical window-to-application association (`get_window_app()`).
- [`Shell.App`](https://gnome.pages.gitlab.gnome.org/gnome-shell/shell/class.App.html) - application object used by the existing App Expose implementation.

---

## 24. Final design rule

If implementation choices become ambiguous, preserve this separation:

```text
Gesture/navigation layer:
    Which Overview state are we moving toward?

Visibility/App Expose layer:
    Which WindowPreviews are present?

Grouped layout layer:
    How are the present WindowPreviews organized into application regions?
```

The grouped layout layer must remain persistent and entry-point-agnostic. That is what makes swipe-up and regular GNOME Overview genuinely the same Mission Control-style view instead of two superficially similar gesture paths.
