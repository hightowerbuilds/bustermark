# First signed release: v0.1.0 for Intel Macs

Status: **built, notarized, and installed** (2026-10-20). Apple Silicon is out of
scope for now; the Intel build runs there under Rosetta.

## Artifact

- `BusterMark_0.1.0_x64.dmg`, 8.25 MiB.
  SHA-256 `ad8b3436e922287576138f7665358ac80b750a45242978968cda20910e0f3150`.
- The app is x86_64 only, version 0.1.0, `com.lukehightower.buster`, minimum macOS
  11.0 (raised from 10.15, because native printing needs 11).
- Signed by `Developer ID Application: Luke Hightower (KD977J8NF6)` with the
  hardened runtime and a secure timestamp. No entitlements were needed.

## Notarization

- The app was submitted by Tauri as `6776aefd-34ce-4832-8571-2a47b5220813`:
  **Accepted**, and stapled.
- The DMG was submitted separately as `c0590a68-051b-4e69-9f24-76b7a6a48cbb`:
  **Accepted**, no issues, 3 tickets; stapled.
- `stapler validate` passes on both. Gatekeeper (`spctl`) reports "Notarized
  Developer ID" for the app, the DMG, and the installed copy.

## Install check

Copied from the mounted DMG into /Applications and launched with `open`, as Finder
does. The writer confirmed:
- no Gatekeeper warning;
- their notes and settings were there;
- Claude Code connected in the sidebar and answered;
- Spread opened on a right-click.

## How

`scripts/release-macos-intel.sh` repeats this. Tauri signs and notarizes the app,
staples it, and builds and signs the DMG. It never notarizes the DMG, so the script
submits and staples it. The steps follow the Buster Claw project's Apple roadmap,
which hit that DMG gap in August.

- **Credentials:** the Apple ID with an app-specific password failed with 401 ("Your
  Apple ID has been locked"). The team's App Store Connect API key (Developer role)
  worked, and is saved as the `bustermark-notary` notarytool profile.
- **Identity:** signing uses the certificate's SHA-1, because its name matches copies
  in both the login and System keychains.

`release.yml` is now Intel-only and manual, and refuses to run without the signing
secrets, so a tag push can't publish an unsigned build. Signed CI releases need those
secrets added to GitHub (Docket, later).

## Not done

- Auto-updates (Docket, later).
- The browser-download Gatekeeper check (release step 8), after the release is public.
