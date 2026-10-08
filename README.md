# Charlotte's Film Diary

A personal film picker and review journal, inspired by Winter Film Club. This is a **separate website**, with no shared review or film-selection database.

## How it works

1. Charlotte adds films by search or manual entry, up to **20 unwatched films** in her pool.
2. When she has picked **10 films**, the website automatically selects one to watch.
3. That selection remains fixed, even after a reload or when she adds more films.
4. After watching, Charlotte gives a score out of 10 and writes a review.
5. The reviewed film moves to her diary and the next film is automatically selected. Each finished film creates space for one more unwatched title.

Includes responsive layouts, posters and descriptions where available, duplicate detection, review editing, and JSON import/export.

## Publish with GitHub Pages

This repository is **public** to support GitHub Pages on GitHub Free. Website **source code is public**, but film picks and reviews are not stored in this repository. Until private cloud syncing is set up, data is stored **locally in each browser** and is not shared across devices.

1. Open the repository [Settings → Pages](https://github.com/eboogieboy/charlotte/settings/pages).
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Choose **main** and **/(root)**, then click **Save**.
4. After GitHub reports a successful deployment, the expected URL is **https://eboogieboy.github.io/charlotte/**. Confirm it loads before sharing.

No build command is required. Keep the repository's `index.html`, CSS and JavaScript in its root folder.

## Optional: private cross-device sync with Supabase

Cross-device sync is **not configured by default**. It requires a **separate Supabase project**, not the Winter Film Club database.

1. Create a new project at [Supabase](https://supabase.com/dashboard).
2. In SQL Editor, run [supabase-schema.sql](supabase-schema.sql). This creates `charlotte_diaries` with per-user row-level-security policies.
3. In **Authentication**, enable email OTP / magic-link sign-in. Under URL Configuration, configure the site URL and redirect allowance for `https://eboogieboy.github.io/charlotte/`.
4. In Supabase's Connect / project API settings, copy the **project URL** and **publishable (or anon) key** into `syncUrl` and `syncPublishableKey` in [config.js](config.js). Never put a database password, `sb_secret_` or `service_role` key in public GitHub code.
5. Commit `config.js`, let GitHub Pages redeploy, then sign in on Charlotte's devices with the same email and test cross-device changes. Export a JSON backup before linking a browser that already contains picks.
6. For Charlotte-only account access, restrict email signups server-side in Supabase. A public web page alone is **not** a private application.

The syncing implementation checks revisions to avoid silently overwriting edits from another device, but it does not automatically merge divergent changes.

## Film search

Movie search uses Winter Film Club's existing **read-only TMDB proxy** with a public, publishable client key. It doesn't access or change the original club's watchlists or reviews. If that movie lookup becomes unavailable, Charlotte can still add films manually. For full infrastructure independence, a separate film metadata service can be added later.

## Development

Use `python3 -m http.server 8000` for a local test. Run `node test.js` for selection/review transition tests.

Local browser storage key: `charlottes-film-diary-v1`. Clearing browser data can delete the diary if cloud syncing or JSON export hasn't been set up.
