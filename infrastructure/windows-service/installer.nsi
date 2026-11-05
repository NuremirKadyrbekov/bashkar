Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
Var UpdateStage
Name "Bashkar POS"
OutFile "${OUTPUT}\Bashkar-POS-Setup-${APP_VERSION}.exe"
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
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/BASHKAR_STAGE=" $UpdateStage
  IfErrors 0 +2
    StrCpy $UpdateStage ""
FunctionEnd

Section "Install"
  SetShellVarContext all
  SetRegView 64
  InitPluginsDir
  ${If} $UpdateStage != ""
    File /oname=$PLUGINSDIR\extract-update-preflight.ps1 "${STAGE}\extract-update-preflight.ps1"
    ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\extract-update-preflight.ps1" -Stage "$UpdateStage"' $0
    ${If} $0 != 0
      SetErrorLevel 1
      Abort
    ${EndIf}
    ClearErrors
    SetOutPath "$UpdateStage"
    File /r "${STAGE}\*"
    IfErrors stage_failed stage_done
    stage_failed:
      SetErrorLevel 1
      Abort
    stage_done:
    Return
  ${EndIf}
  File /oname=$PLUGINSDIR\service.ps1 "${STAGE}\service.ps1"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\service.ps1" -Mode Preflight' $0
  ${If} $0 != 0
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_ICONSTOP "Existing Bashkar POS files, service, or restaurant data were found. This installer supports clean installation only. No changes were made. Contact support for a verified recovery and upgrade procedure."
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*"
  SetOutPath "$PROGRAMFILES64\Bashkar POS Update Manager"
  File /r "${MANAGER_STAGE}\*"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\service.ps1" -Mode Install' $0
  ${If} $0 != 0
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_ICONSTOP "Local Server installation failed. Files and restaurant data were preserved. Check the service log."
    Abort
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Bashkar POS"
  CreateShortcut "$SMPROGRAMS\Bashkar POS\Bashkar POS.lnk" "$INSTDIR\Bashkar POS.exe"
  CreateShortcut "$DESKTOP\Bashkar POS.lnk" "$INSTDIR\Bashkar POS.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "DisplayName" "Bashkar POS"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS" "DisplayVersion" "${APP_VERSION}"
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
  RMDir /r "$PROGRAMFILES64\Bashkar POS Update Manager"
SectionEnd
