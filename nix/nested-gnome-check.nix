{
  runCommand,
  gnugrep,
  gnome-shell,
  extension,
  extensionUuid,
  launcher,
  presentationOption,
  shellMajorVersion,
}:

runCommand "nested-gnome-${shellMajorVersion}-check" { } ''
  set -eu
  ${gnome-shell}/bin/gnome-shell --version | ${gnugrep}/bin/grep -Eq '^GNOME Shell ${shellMajorVersion}([.]|$)'
  ${gnome-shell}/bin/gnome-shell --help 2>&1 | ${gnugrep}/bin/grep -q -- '${presentationOption}'
  ${gnome-shell}/bin/gnome-shell --help 2>&1 | ${gnugrep}/bin/grep -q -- '--wayland'
  ${gnome-shell}/bin/gnome-shell --help 2>&1 | ${gnugrep}/bin/grep -q -- '--wayland-display'
  test -x ${launcher}/bin/nested-gnome-${shellMajorVersion}
  ${gnugrep}/bin/grep -q 'HOME="$profile/home"' ${launcher}/bin/nested-gnome-${shellMajorVersion}
  ${gnugrep}/bin/grep -q 'XDG_CONFIG_HOME="$profile/config"' ${launcher}/bin/nested-gnome-${shellMajorVersion}
  ${gnugrep}/bin/grep -q 'XDG_RUNTIME_DIR="$profile/runtime"' ${launcher}/bin/nested-gnome-${shellMajorVersion}
  ${gnugrep}/bin/grep -q 'dbus-run-session' ${launcher}/bin/nested-gnome-${shellMajorVersion}
  session_launcher=$(${gnugrep}/bin/grep -o '/nix/store/[^" ]*-nested-gnome-${shellMajorVersion}-session/bin/nested-gnome-${shellMajorVersion}-session' ${launcher}/bin/nested-gnome-${shellMajorVersion})
  test -n "$session_launcher"
  nested_display_line=$(${gnugrep}/bin/grep -n -m1 'export WAYLAND_DISPLAY="$nested_display"' "$session_launcher" | cut -d: -f1)
  extension_probe_line=$(${gnugrep}/bin/grep -n -m1 'gnome-extensions info' "$session_launcher" | cut -d: -f1)
  test "$nested_display_line" -lt "$extension_probe_line"
  ${gnugrep}/bin/grep -q 'dbus-update-activation-environment WAYLAND_DISPLAY' "$session_launcher"
  ${gnugrep}/bin/grep -q 'env -u DISPLAY -u WAYLAND_DISPLAY' ${launcher}/bin/nested-gnome-${shellMajorVersion}
  ${
    if presentationOption == "--devkit" then
      ''
        if ${gnugrep}/bin/grep -q -- '--virtual-monitor' "$session_launcher"; then
          exit 1
        fi
        ${gnugrep}/bin/grep -q 'wireplumber' "$session_launcher"
        ${gnugrep}/bin/grep -q 'DBUS_SYSTEM_BUS_ADDRESS:-' "$session_launcher"
        ${gnugrep}/bin/grep -q '/run/dbus/system_bus_socket' "$session_launcher"
      ''
    else
      ''
        ${gnugrep}/bin/grep -q -- '--no-x11' "$session_launcher"
        ${gnugrep}/bin/grep -q '__EGL_VENDOR_LIBRARY_FILENAMES' "$session_launcher"
        ${gnugrep}/bin/grep -q 'LIBGL_DRIVERS_PATH' "$session_launcher"
      ''
  }
  test -f ${extension}/share/gnome-shell/extensions/${extensionUuid}/metadata.json
  test -f ${extension}/share/gnome-shell/extensions/${extensionUuid}/schemas/gschemas.compiled
  ${gnugrep}/bin/grep -q 'group-overview-by-application' ${extension}/share/gnome-shell/extensions/${extensionUuid}/schemas/org.gnome.shell.extensions.touchpad-gesture-customization.gschema.xml
  mkdir -p "$out"
  touch "$out/passed"
''
