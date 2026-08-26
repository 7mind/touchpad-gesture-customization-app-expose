{
  lib,
  writeShellApplication,
  bashInteractive,
  coreutils,
  dbus,
  dconf,
  foot,
  glib,
  gnome-calculator,
  gnome-shell,
  gnugrep,
  pipewire,
  xdpyinfo,
  extension,
  extensionUuid,
  presentationMode,
  shellMajorVersion,
  wireplumber,
}:

assert presentationMode == "nested-x11" || presentationMode == "mutter-devkit";

let
  usesMutterDevkit = presentationMode == "mutter-devkit";
  dataDirectories = lib.makeSearchPath "share" (
    [
      dconf
      foot
      glib
      gnome-calculator
      gnome-shell
    ]
    ++ lib.optionals usesMutterDevkit [
      pipewire
      wireplumber
    ]
  );
  shellArguments =
    if usesMutterDevkit then
      [
        "--devkit"
        "--no-x11"
      ]
    else
      [
        "--nested"
        "--wayland"
      ];
  session = writeShellApplication {
    name = "nested-gnome-${shellMajorVersion}-session";
    runtimeInputs = [
      bashInteractive
      coreutils
      dconf
      foot
      glib
      gnome-calculator
      gnome-shell
      gnugrep
    ]
    ++ lib.optionals usesMutterDevkit [
      pipewire
      wireplumber
    ];
    text = ''
      profile="$1"
      nested_display="touchpad-gesture-gnome-${shellMajorVersion}-$PPID"
      extension_dir="$XDG_DATA_HOME/gnome-shell/extensions/${extensionUuid}"
      shell_pid=""
      child_pids=()

      if [[ -z "''${DBUS_SYSTEM_BUS_ADDRESS:-}" ]] && [[ ! -S /run/dbus/system_bus_socket ]]; then
        export DBUS_SYSTEM_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"
      fi

      cleanup() {
        local pid

        for pid in "''${child_pids[@]}"; do
          kill "$pid" 2>/dev/null || true
        done

        if [[ -n "$shell_pid" ]]; then
          kill "$shell_pid" 2>/dev/null || true
          wait "$shell_pid" 2>/dev/null || true
        fi
      }

      trap cleanup EXIT
      trap 'exit 130' INT
      trap 'exit 143' TERM

      mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions"
      ln -s "${extension}/share/gnome-shell/extensions/${extensionUuid}" "$extension_dir"
      export GSETTINGS_SCHEMA_DIR="$extension_dir/schemas"
      gsettings set org.gnome.shell.extensions.touchpad-gesture-customization group-overview-by-application true

      ${lib.optionalString (!usesMutterDevkit) "unset WAYLAND_DISPLAY"}
      ${lib.optionalString usesMutterDevkit ''
        pipewire &
        child_pids+=("$!")

        pipewire_ready=0
        for _ in $(seq 1 40); do
          if ! kill -0 "''${child_pids[0]}" 2>/dev/null; then
            wait "''${child_pids[0]}"
          fi

          if [[ -S "$XDG_RUNTIME_DIR/pipewire-0" ]]; then
            pipewire_ready=1
            break
          fi

          sleep 0.25
        done

        if [[ "$pipewire_ready" -ne 1 ]]; then
          printf 'PipeWire did not become ready within 10 seconds.\n' >&2
          exit 1
        fi

        wireplumber &
        child_pids+=("$!")

        wireplumber_ready=0
        for _ in $(seq 1 40); do
          if ! kill -0 "''${child_pids[1]}" 2>/dev/null; then
            wait "''${child_pids[1]}"
          fi

          if wpctl status >/dev/null 2>&1; then
            wireplumber_ready=1
            break
          fi

          sleep 0.25
        done

        if [[ "$wireplumber_ready" -ne 1 ]]; then
          printf 'WirePlumber did not become ready within 10 seconds.\n' >&2
          exit 1
        fi
      ''}
      MUTTER_DEBUG_DUMMY_MODE_SPECS="1440x900@60.0" \
        gnome-shell \
          ${lib.escapeShellArgs shellArguments} \
          --wayland-display="$nested_display" &
      shell_pid=$!

      ready=0
      for _ in $(seq 1 120); do
        if ! kill -0 "$shell_pid" 2>/dev/null; then
          wait "$shell_pid"
        fi

        if [[ -S "$XDG_RUNTIME_DIR/$nested_display" ]] && \
          gnome-extensions info "${extensionUuid}" >/dev/null 2>&1; then
          ready=1
          break
        fi

        sleep 0.25
      done

      if [[ "$ready" -ne 1 ]]; then
        printf 'GNOME Shell %s did not become ready within 30 seconds.\n' '${shellMajorVersion}' >&2
        exit 1
      fi

      gnome-extensions enable "${extensionUuid}"
      gnome-extensions info "${extensionUuid}"

      export WAYLAND_DISPLAY="$nested_display"
      unset DISPLAY

      foot --title="GNOME ${shellMajorVersion} test window A" &
      child_pids+=("$!")
      foot --title="GNOME ${shellMajorVersion} test window B" &
      child_pids+=("$!")
      gnome-calculator &
      child_pids+=("$!")
      gnome-extensions prefs "${extensionUuid}" &
      child_pids+=("$!")

      printf 'GNOME Shell %s is running with an isolated profile at %s.\n' '${shellMajorVersion}' "$profile"
      printf 'The grouped Overview setting is stored as true for compatibility testing.\n'
      wait "$shell_pid"
    '';
  };
in
writeShellApplication {
  name = "nested-gnome-${shellMajorVersion}";
  runtimeInputs = [
    coreutils
    dbus
    xdpyinfo
  ];
  text = ''
    ${
      if usesMutterDevkit then
        ''
          host_wayland_socket=""
          if [[ -n "''${WAYLAND_DISPLAY:-}" ]] && [[ -n "''${XDG_RUNTIME_DIR:-}" ]]; then
            if [[ "$WAYLAND_DISPLAY" = /* ]]; then
              candidate="$WAYLAND_DISPLAY"
            else
              candidate="$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
            fi

            if [[ -S "$candidate" ]]; then
              host_wayland_socket="$candidate"
            fi
          fi

          if [[ -n "$host_wayland_socket" ]]; then
            export WAYLAND_DISPLAY="$host_wayland_socket"
          elif [[ -n "''${DISPLAY:-}" ]] && xdpyinfo >/dev/null 2>&1; then
            unset WAYLAND_DISPLAY
          else
            printf 'A reachable host Wayland or Xwayland display is required. Run this command from a terminal inside the graphical login session.\n' >&2
            exit 1
          fi
        ''
      else
        ''
          if [[ -z "''${DISPLAY:-}" ]]; then
            printf 'GNOME Shell ${shellMajorVersion} requires a graphical host session with Xwayland; DISPLAY is unset.\n' >&2
            exit 1
          fi

          if ! xdpyinfo >/dev/null 2>&1; then
            printf 'The host Xwayland display is inaccessible. Run this command from a terminal inside the graphical login session and verify DISPLAY/XAUTHORITY.\n' >&2
            exit 1
          fi
        ''
    }

    profile=$(mktemp -d --tmpdir "touchpad-gesture-gnome-${shellMajorVersion}.XXXXXXXXXX")

    cleanup() {
      rm -rf -- "$profile"
    }

    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM

    mkdir -p \
      "$profile/home" \
      "$profile/config" \
      "$profile/data" \
      "$profile/cache" \
      "$profile/state" \
      "$profile/runtime" \
      "$profile/tmp"
    chmod 700 "$profile/runtime"

    HOME="$profile/home" \
      XDG_CONFIG_HOME="$profile/config" \
      XDG_DATA_HOME="$profile/data" \
      XDG_CACHE_HOME="$profile/cache" \
      XDG_STATE_HOME="$profile/state" \
      XDG_RUNTIME_DIR="$profile/runtime" \
      XDG_DATA_DIRS="${dataDirectories}" \
      TMPDIR="$profile/tmp" \
      dbus-run-session -- "${session}/bin/nested-gnome-${shellMajorVersion}-session" "$profile"
  '';
}
