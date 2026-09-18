# Installing the IHOP Operations Dashboard

One installer, then a short setup screen. Nothing else to install, no Terminal, no settings files.

## 1. Install

**Mac.** Open `IHOP-Operations-<version>.dmg` and drag **IHOP Operations** onto **Applications**. Open it from Applications.

**Windows.** Run `IHOP-Operations-Setup-<version>.exe` and choose Install. It installs for your account only, so it does not ask for an administrator. Leave "Start when I sign in" ticked.

Your browser opens the dashboard at http://localhost:4000. There is no window to keep open: look for the small pancake-stack icon in the menu bar (Mac) or near the clock (Windows). Its menu has **Open Dashboard**, **Show Reports Folder**, **Start When I Log In**, **Let Others on This Network Open It** and **Quit**.

> **First-open warning.** Until the app is signed with a paid Apple / Microsoft publisher certificate, each system shows a one-time warning.
> Mac: "IHOP Operations can't be opened" → open **System Settings > Privacy & Security**, scroll down, choose **Open Anyway**.
> Windows: blue "Windows protected your PC" → **More info** → **Run anyway**.
> See "For the person who builds the installers" below to remove these warnings for good.

## 2. Create your account

The first screen asks you to create the administrator account (name, email, a password of 10+ characters). That person sees every restaurant and adds everyone else later under **Data and refresh > People and access**.

## 3. Get connected

You land on **Get connected**, a four-line checklist that ticks itself off as data arrives:

1. **Connect Rosnet.** Set up the **Reports mailbox**: a new Gmail account made just for reports (2-Step Verification on, then an app password from myaccount.google.com/apppasswords). Enter the address and app password, press **Test connection**, and save. Then, in Rosnet, schedule the daily reports (push reports) to email that address, as Excel or CSV. When the first one arrives, press **Test connection** again and click the sender to trust it. If Rosnet ever issues an API key, there is a box for that too, but it is optional.
2. **Put restaurants in their regions and areas.** Import a store list once (Store Number, Restaurant, Region, Area, Area Manager, City, State) under **Reports and layouts**.
3. **Load sales and labor.** Export the last few weeks from Rosnet and import them. The dashboard guesses the columns; confirm them once and name the layout. Every later copy that arrives by email or folder loads by itself. A report that arrives in a layout the dashboard hasn't seen is kept and shown with a **Fix layout** button, so nobody has to export it again.
4. **Forecast sales and allowable hours.** Include the Rosnet report that has them in the scheduled emails, and confirm its layout once.

Any report saved into **Documents > IHOP Operations Reports** is also imported on the next refresh.

Details, and ready-to-send emails to Rosnet and Merchant Centric: `docs/connecting-rosnet-and-stars.md`.

## Good to know

- **The dashboard updates while it is running.** With "start when I sign in" on, that is whenever the computer is on; it also keeps the computer from sleeping. For a team to rely on it every morning, use a computer that stays on, or host it online (README, "Hosting it online").
- **Sharing with the office.** By default only this computer can open the dashboard. Choose **Let Others on This Network Open It** in the icon's menu, and colleagues can use `http://<this computer's name>:4000`. The system firewall may ask once to allow it.
- **Your data is kept apart from the app.** Mac: `~/Library/Application Support/IHOP Operations`. Windows: `%LOCALAPPDATA%\IHOP Operations`. Back up that folder (it holds `ops.db` and the `.secret-key` that unlocks the saved passwords; keep them together). To move to another computer, install there and copy the folder across.
- **Updating.** Install the new version over the old one. Data and settings are untouched.
- **Uninstalling.** Mac: quit from the menu bar icon and drag the app to the Trash. Windows: Settings > Apps; it asks whether to keep or delete your data.
- **Passwords.** The Rosnet API key and the mailbox password are stored encrypted and never shown again. Nobody's Rosnet website password is ever used or stored.

## For the person who builds the installers

```bash
packaging/build-mac.sh                                           # on a Mac: release/IHOP-Operations-<version>.dmg
powershell -ExecutionPolicy Bypass -File packaging\build-windows.ps1   # on Windows with Inno Setup 6: release\IHOP-Operations-Setup-<version>.exe
```

Both bundle their own copy of Node (checksum-verified from nodejs.org), so the client installs nothing else.

**Removing the first-open warnings** takes publisher certificates, which only the account holder can buy:

- **Mac:** an Apple Developer Program membership. Create a *Developer ID Application* certificate, store notary credentials with `xcrun notarytool store-credentials`, then build with `MAC_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" MAC_NOTARY_PROFILE=<profile> packaging/build-mac.sh`. The script signs, notarizes and staples.
- **Windows:** a code-signing certificate (or Azure Trusted Signing); sign the setup program and `IHOP Operations.exe` with `signtool`.

## Without an installer

The plain zip still works anywhere Node 22.9+ is installed: unzip, then double-click `Start Dashboard.command` (Mac) or `Start Dashboard.bat` (Windows). Setup is the same from step 2.
