# Installing the IHOP Operations Dashboard

Works on macOS and Windows. About five minutes.

## 1. Install Node.js (one time)

Download the **LTS** installer from https://nodejs.org and run it. Version 22.9 or newer is required.

## 2. Unzip and start

Unzip `ihop-operations-dashboard.zip` somewhere permanent (Documents is fine, not Downloads).

- **Mac:** double-click `Start Dashboard.command`.
  The first time, macOS may say it can't be opened because it is from an unidentified developer. **Right-click it, choose Open, then Open again.** You only do that once.
  If it says you don't have permission, open Terminal and run: `chmod +x ~/Documents/ihop-operations-dashboard/"Start Dashboard.command"` (adjust the path to where you unzipped it).
- **Windows:** double-click `Start Dashboard.bat`. If Windows shows a blue "protected your PC" box, choose More info, then Run anyway.

A window opens and stays open while the dashboard runs. Your browser opens at http://localhost:4000. To stop the dashboard, close that window.

## 3. Create your account

The first screen asks you to create the administrator account (name, email, a password of 10+ characters). That person sees every restaurant and adds everyone else under **Data and refresh > People and access**.

## 4. Load your data

Go to **Data and refresh > Reports and layouts** and import one copy of each Rosnet report and your Merchant Centric STARS export. Check the column matches, name the layout, import. Then set up automatic delivery so nobody has to do that again: see `docs/connecting-rosnet-and-stars.md`.

The simplest automatic route: any report saved into the `server/import` folder inside the dashboard folder is picked up on the next refresh.

## Good to know

- **The dashboard only updates while it is running.** On a laptop that is closed or off at 5:30am, the morning refresh runs the next time it starts. For a team to rely on it every morning, run it on a computer that stays on, or host it online (see README, "Hosting it online").
- **Other people on the same office network** can open it at `http://<this computer's name or IP>:4000` while it is running. The Mac or Windows firewall may ask once to allow incoming connections.
- **Your data lives in one file:** `server/ops.db`. Back it up by copying that file while the dashboard is stopped. To move to another computer, copy the whole folder.
- **Settings** (mailbox for emailed reports, folder, push token) go in `server/.env`. Restart the dashboard after changing it.
- **Updating to a new version:** unzip the new version, then copy your `server/ops.db` and `server/.env` from the old folder into the new one.
