Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "Bashkar POS"
OutFile "${OUTPUT}\Bashkar-POS-Setup-0.1.0.exe"
InstallDir "$PROGRAMFILES64\Bashkar POS"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Bashkar POS requires Windows x64."
    Abort
  ${EndIf}
FunctionEnd

Section "Install"
  SetShellVarContext all
  SetRegView 64
  InitPluginsDir
  File /oname=$PLUGINSDIR\service.ps1 "${STAGE}\service.ps1"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\service.ps1" -Mode Stop' $0
  IntCmp $0 0 +3
    MessageBox MB_ICONSTOP "Could not stop Bashkar POS Local Server. Installation was cancelled."
    Abort
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\service.ps1" -Mode Install' $0
  IntCmp $0 0 +3
    MessageBox MB_ICONSTOP "Local Server installation failed. Files and restaurant data were preserved. Check the service log."
    Abort
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Bashkar POS"
  CreateShortcut "$SMPROGRAMS\Bashkar POS\Bashkar POS.lnk" "$INSTDIR\Bashkar POS.exe"
  CreateShortcut "$DESKTOP\Bashkar POS.lnk" "$INSTDIR\Bashkar POS.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "DisplayName" "Bashkar POS"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "DisplayVersion" "0.1.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "Publisher" "Bashkar"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "DisplayIcon" "$INSTDIR\Bashkar POS.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "UninstallString" '$"$INSTDIR\Uninstall.exe$"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\service.ps1" -Mode Uninstall' $0
  IntCmp $0 0 +3
    MessageBox MB_ICONSTOP "Could not remove the Local Server service. Program files were preserved."
    Abort
  Delete "$DESKTOP\Bashkar POS.lnk"
  Delete "$SMPROGRAMS\Bashkar POS\Bashkar POS.lnk"
  RMDir "$SMPROGRAMS\Bashkar POS"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS"
  RMDir /r "$INSTDIR"
SectionEnd
