; Picked up automatically by electron-builder (build/installer.nsh).
; Branded splash for a fresh interactive install; skipped for silent runs and auto-updates.
!macro customInit
  IfSilent skipSplash
  ${if} ${isUpdated}
    Goto skipSplash
  ${endif}
  InitPluginsDir
  File /oname=$PLUGINSDIR\splash.bmp "${BUILD_RESOURCES_DIR}\splash.bmp"
  advsplash::show 1200 250 250 0xFF00FF $PLUGINSDIR\splash
  Pop $0
  skipSplash:
!macroend
