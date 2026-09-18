; IHOP Operations for Windows: one setup program, no administrator rights, nothing else to install.
; Built by packaging/build-windows.ps1, which passes /DAppVersion and /DStageDir.
#define AppName "IHOP Operations"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\release\windows\stage"
#endif

[Setup]
AppId={{6B0D4C0E-5C0B-4F0E-9B1E-1A7F3D2C9E41}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=IHOP Operations Dashboard
; Per-user install: no "Do you want to allow this app to make changes" prompt, no IT ticket.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#AppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
DefaultGroupName={#AppName}
UninstallDisplayIcon={app}\{#AppName}.exe
SetupIconFile=..\assets\icon.ico
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\release
OutputBaseFilename=IHOP-Operations-Setup-{#AppVersion}
; An update closes the running copy first (its job object takes the server down with it).
CloseApplications=force
RestartApplications=no

[Tasks]
Name: "startup"; Description: "Start {#AppName} when I sign in (recommended: the morning refresh needs it running)"
Name: "desktopicon"; Description: "Create a desktop shortcut"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppName}.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppName}.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppName}.exe"" --background"; Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppName}.exe"; Description: "Open {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM ""{#AppName}.exe"" /F"; Flags: runhidden; RunOnceId: "StopDashboard"

[Code]
// The database, reports and settings live in the person's own folders and are never removed
// by an update. On uninstall, ask before leaving or deleting them.
procedure PrepareToInstallStop();
var ResultCode: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/C taskkill /IM "{#AppName}.exe" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  PrepareToInstallStop();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    if MsgBox('Also delete the dashboard''s data (results, accounts and settings)?' + #13#10 + 'Choose No to keep it for a later reinstall.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{localappdata}\{#AppName}'), True, True, True);
end;
