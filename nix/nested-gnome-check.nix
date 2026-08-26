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
  test -f ${extension}/share/gnome-shell/extensions/${extensionUuid}/metadata.json
  test -f ${extension}/share/gnome-shell/extensions/${extensionUuid}/schemas/gschemas.compiled
  ${gnugrep}/bin/grep -q 'group-overview-by-application' ${extension}/share/gnome-shell/extensions/${extensionUuid}/schemas/org.gnome.shell.extensions.touchpad-gesture-customization.gschema.xml
  mkdir -p "$out"
  touch "$out/passed"
''
