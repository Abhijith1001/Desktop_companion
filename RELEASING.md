# Releasing and running Desktop Buddy

How to ship a version, run the landing page and admin panel, and get listed on
the Microsoft Store and winget. Set up once (sections 1–3), then each release is
section 4.

---

## 1. Admin panel (feedback, crashes, users, announcements)

The admin panel is part of the sync server at `https://<your-server>/admin`.

1. Make a long random password (24+ characters):
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
2. Render dashboard → **desktop-buddy-server** → **Environment** → add `ADMIN_TOKEN` with that value → save (Render redeploys).
3. Open `https://desktop-buddy-server.onrender.com/admin` and sign in with the token.

| Tab | What it's for |
|---|---|
| Overview | Sync accounts, new and active this week, open feedback, crash counts, popular characters |
| Feedback | Messages from **Send feedback** in the app. Mark read or done, reply by email if one was left |
| Crashes | Opt-in crash reports, grouped so the same error shows once with a count. Mark resolved when fixed |
| Users | Search sync accounts and delete an account with its synced tasks |
| Announcements | Banner shown in every app (checked every 6 hours). Optional link and start/end dates |

Without `ADMIN_TOKEN`, `/admin` and `/api/admin` return 404. Locally, put `ADMIN_TOKEN=...` in `server/.env` and open `http://localhost:4000/admin`.

> Only people with a sync account appear under Users. Local-only users are never tracked.

## 2. Landing page (GitHub Pages)

1. GitHub repo → **Settings → Pages → Source: GitHub Actions**.
2. Push to `main`. The **Landing page** workflow publishes `site/` plus the real buddy art to
   `https://abhijith1001.github.io/Desktop_companion/`.
3. The download buttons find the newest `.exe` on GitHub Releases automatically.

To preview locally, copy the buddy files next to the page and open it in a browser:
```bash
mkdir -p site/buddy && cp electron/pet/characters.js electron/pet/buddy.css site/buddy/
```
(`site/buddy/` is ignored by git; the workflow copies fresh files on every deploy.)

**Recommended:** record a 10-second GIF of the real buddy with [ScreenToGif](https://www.screentogif.com/) for the README and Store listing.

## 3. Code signing (optional, recommended)

Unsigned installers show **"Windows protected your PC"**. The cheapest fix is
[Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) (about $10 a month):

1. Create a Trusted Signing account and certificate profile in Azure, plus an app registration with the *Trusted Signing Certificate Profile Signer* role.
2. Add repo secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`.
3. Add this to `build.win` in `package.json`:
   ```json
   "azureSignOptions": {
     "publisherName": "Devwerks",
     "endpoint": "https://eus.codesigning.azure.net",
     "codeSigningAccountName": "<account>",
     "certificateProfileName": "<profile>"
   }
   ```
4. In `.github/workflows/release.yml`, pass the three secrets as env vars to the **Build and publish installer** step.

The Microsoft Store signs Store builds for you, so this only matters for the direct download.

## 4. Ship a release

```bash
npm version minor          # or patch / major: bumps package.json and tags v2.2.0
git push --follow-tags
```

The **Release** workflow then:
1. runs the unit tests,
2. checks that the tag matches `package.json`,
3. builds the installer and publishes it as a GitHub Release,
4. updates winget (once section 6 is done).

Installed apps download the update in the background and install it on the next restart.
The landing page links to the new installer straight away.

To build locally without publishing, run `npm run dist` (the output goes to `release/`).

## 5. Microsoft Store

1. Register at [Partner Center](https://partner.microsoft.com/dashboard/registration) as an individual developer (free).
2. **Apps and games → New product → MSIX or PWA app** → reserve the name *Desktop Buddy*.
3. **Product management → Product identity**: copy the three values into your terminal and build:
   ```powershell
   $env:STORE_IDENTITY_NAME  = "12345Devwerks.DesktopBuddy"
   $env:STORE_PUBLISHER      = "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
   $env:STORE_PUBLISHER_NAME = "Devwerks"
   npm run dist:store         # → release/Desktop-Buddy-<version>.appx
   ```
4. Create a submission:
   - Upload the `.appx`.
   - Add 4+ screenshots at 1920×1080, with the buddy on the desktop and the task manager.
   - Write a description (reuse the landing page text).
   - Privacy policy URL: `https://abhijith1001.github.io/Desktop_companion/privacy.html`
   - Category: *Productivity*. Complete the age rating questionnaire.
5. Submit. The first review usually takes 1–3 days.

The Store build turns off the built-in updater (`process.windowsStore`), because the Store delivers
updates. For each new version, run `npm run dist:store` and upload the package in a new submission.

## 6. winget

First submission, done once by hand:
1. Get the SHA256 of the released installer:
   `certutil -hashfile release\Desktop-Buddy-Setup-<version>.exe SHA256`
2. Update the version, URL and hash in `packaging/winget/*.yaml`, or let
   [wingetcreate](https://github.com/microsoft/winget-create) do it:
   ```powershell
   winget install wingetcreate
   wingetcreate new https://github.com/Abhijith1001/Desktop_companion/releases/download/v<version>/Desktop-Buddy-Setup-<version>.exe
   ```
   Use the identifier `Devwerks.DesktopBuddy`, and copy the descriptions from `packaging/winget/`.
3. Submit the pull request to `microsoft/winget-pkgs`. Once it's merged, people can run `winget install Devwerks.DesktopBuddy`.

Every release after that is automatic: create a classic GitHub token with the
`public_repo` scope and save it as the repo secret `WINGET_TOKEN`.

## 7. Feedback and crash reports in the app

- **Send feedback** (sidebar): idea, problem, love or other, with an optional email. It goes to the Feedback tab in the admin panel.
- **Crash reports** (Settings → Crash reports): **off by default**. When on, main-process errors, UI errors and renderer crashes are sent with the app and Windows version. User folder names are removed on the server.
- **Announcements**: the newest active one shows as a banner at the top of the task manager until the user dismisses it.

All of these use the server set in Account & sync (the hosted Render server by default) and need no account.
