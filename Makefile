NAME=touchpad-gesture-customization
DOMAIN=coooolapps.com
UUID=${NAME}@${DOMAIN}
BUILDIR=build
ZIPPATH=${BUILDIR}/${UUID}.zip

.PHONY: pack update

pack:
	@test -s ${BUILDIR}/extension.js || { echo 'ERROR: ${BUILDIR}/extension.js is missing — run `npm run build` (or `npm run pack`) first; `make pack` will not package a build without a transpiled extension.js' >&2; exit 1; }
	mkdir -p ${BUILDIR}
	cp -r extension/assets extension/stylesheet.css extension/ui extension/schemas metadata.json $(BUILDIR)
	rm -f ${ZIPPATH}
	(cd ${BUILDIR} && zip -r ${UUID}.zip .)
	@unzip -l ${ZIPPATH} | grep -qE '(^| )extension.js$$' || { echo 'ERROR: ${ZIPPATH} does not contain extension.js at the root' >&2; rm -f ${ZIPPATH}; exit 1; }
	@unzip -l ${ZIPPATH} | grep -qE '(^| )metadata.json$$' || { echo 'ERROR: ${ZIPPATH} does not contain metadata.json at the root' >&2; rm -f ${ZIPPATH}; exit 1; }

update:
	@test -f ${ZIPPATH} || { echo 'ERROR: ${ZIPPATH} not found — run `npm run pack` first (build + pack must precede update)' >&2; exit 1; }
	@unzip -l ${ZIPPATH} | grep -qE '(^| )extension.js$$' || { echo 'ERROR: ${ZIPPATH} is invalid (no extension.js at root) — run `npm run pack` first' >&2; exit 1; }
	@unzip -l ${ZIPPATH} | grep -qE '(^| )metadata.json$$' || { echo 'ERROR: ${ZIPPATH} is invalid (no metadata.json at root) — run `npm run pack` first' >&2; exit 1; }
	-gnome-extensions uninstall ${UUID} 2>/dev/null || true
	gnome-extensions install -f ${ZIPPATH}