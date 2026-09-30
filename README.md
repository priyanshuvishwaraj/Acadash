# Campus Hub

## Assignment status

Administrators can use **Edit → Closed for everyone** on an assignment, then save it. Uncheck it to reopen the assignment. Closed assignments and assignments whose due date has ended stay visible with a muted appearance and a Closed or Ended label instead of due text. PDFs and details remain readable; the hub disables the submission link. This does not change an external submission service's permissions.

Date-only deadlines end at midnight after the due date in Asia/Kolkata. The page updates this status every 30 seconds and when it regains focus. Active assignments appear before inactive ones and only active assignments appear in Home’s upcoming list. Closing applies to everyone; individual student submissions are not tracked.

The local database adds the status column automatically. Cloud installations must redeploy the `hub` Edge Function with the updated shared model alongside the frontend; the existing JSON state needs no SQL migration.

## Cloud deployment (Supabase + Google Drive)

The app now supports a statically hosted frontend with Supabase data/admin sign-in,
Google Drive PDF uploads and deletion, and stored first-page previews. Follow
[the cloud setup guide](docs/CLOUD_SETUP.md) for account setup, schema deployment,
Google OAuth, administrator access, cleanup scheduling and GitHub Pages publishing.
Set both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to enable it.
Existing local data is preserved; cloud content starts empty until migrated.
The instructions below describe the original local Express/SQLite mode.

A shared campus noticeboard built with React, Express and SQLite. Students can read everything without an account. Administrators publish and edit announcements, assignment PDFs, exams, tests, fests, holidays and the weekly timetable.

Navigation: **Home → Announcements → Assignments → Events → Timetable**. Mobile navigation stays at the bottom, with safe-area padding. The hub refreshes every minute and when the window regains focus; a Refresh button is also available.

## Requirements

Node.js **22.19 or newer** and npm. SQLite uses Node's bundled `node:sqlite` module; no separate database service is required. Node 22 may print an experimental-module notice.

## Run locally

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on port 4000. For a built version:

```sh
npm run build
npm start
```

Express serves both the website and API at `http://localhost:4000`.

## Administrator access

Students do not need credentials. To set up a publisher on a fresh installation:

1. Copy `.env.example` to `.env`.
2. Set `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 12 characters.
3. Run `npm run admin`.
4. Use **Admin sign in** on the website.

If `.env` has already been generated for this workspace, its credentials are ready after `npm run admin`. `.env` is excluded from Git. Do not share it with students. The password is hashed with scrypt in the database, and sign-in uses an eight-hour HttpOnly session cookie. There is no default password or public administrator registration.

To add another class representative, set another username and password in `.env` and run `npm run admin` again. Existing administrators remain. Re-running it for the same username changes that password and revokes their active sessions. The credentials in `.env` are only read by the setup command, not automatically reapplied at server startup.

## Shared database and migration

- Live database: `server/data/hub.sqlite` (override with `DATABASE_PATH`).
- Uploaded documents: `server/uploads/` (override with `UPLOAD_DIR`).
- On first startup, existing `server/data/db.json` records are imported in one transaction. The JSON file and original PDFs are preserved.
- An import marker prevents duplicate imports on restart. All later changes go to SQLite; editing `db.json` no longer changes the hub.
- Announcements, assignments, events and classes are shared across every client connected to this server. Test data uses isolated temporary databases.
- Timetable writes use a revision number to reject stale edits from another administrator. On a conflict, close the class editor, refresh, and open it again.
- Event dates and times are campus local time (IST); blank times display as “Time to be announced.” Events are single-day entries.
- Deleted/replaced PDFs are retained on disk for recovery. Their records disappear from the hub, but an existing direct PDF link remains available until explicit storage maintenance removes the file.

Back up both the database and uploads. For a simple consistent filesystem backup, stop the server, then copy the complete `server/data/` and `server/uploads/` directories. Restore them together. Do not copy only the main SQLite file while writes are active; WAL files may contain committed changes.

## Let other students access it

A database does not itself publish the website. Run **one shared server** rather than a separate copy per student.

For a local campus network, run `npm run build` followed by `npm start`, then share `http://<server-LAN-IP>:4000`. `HOST` defaults to `0.0.0.0`. Network/firewall access must permit that port; the app does not change firewall rules. Use HTTPS for administrator sign-in on a shared network.

For internet access, deploy the Node application to an always-on server with persistent disk and HTTPS:

- Run `npm ci`, `npm run build`, then `npm start` under a process manager.
- Set `NODE_ENV=production` (enables Secure cookies) and `APP_ORIGIN` to the exact HTTPS origin, such as `https://campus.example.edu` without a trailing slash.
- Place `DATABASE_PATH` and `UPLOAD_DIR` on persistent storage. If moving existing PDFs to a custom upload directory, copy them there as well.
- Create the administrator using `npm run admin` against that same database.
- Route the website, `/api`, and `/uploads` through the same HTTPS origin. Public CORS access is deliberately disabled.

This implementation targets one campus hub on one Node server. For several application servers, use a shared database service and shared object storage instead of separate SQLite disks. No external hosting or deployment is configured by this repository.

## Verification

```sh
npm test
npm run build
```

Tests cover migration and rollback, anonymous read access, administrator create/edit/delete permissions, cross-origin rejection, PDF validation, timetable conflicts, restart persistence, session expiry, student/admin rendered markup, navigation order and calendar date boundaries. They do not launch a browser.

## Information discovery

- Use **Search the hub**, **Ctrl+K**, or **Cmd+K** to search updates, resources, assignments, calendar dates, and classes. Arrow keys select results; Enter opens details; Escape closes the dialog. Search includes titles, descriptions, course names/codes, filenames, and available metadata. `today` and `tomorrow` use campus time (Asia/Kolkata). PDF page contents are not indexed.
- News supports category/course filters, an importance filter, source labels, and related calendar events. Administrators set metadata explicitly; existing updates remain in the Campus category.
- Resources support course/type filtering, filename/description search, and recent/title sorting. Assignments support course/deadline filters, recent/due-date sorting, and optional submission links. Both retain compact first-page PDF previews and progressively reveal large lists.
- Item URLs (`#resources?item=...`, for example) open shareable detail dialogs. Course-resource URLs use `#resources?course=...`. Assignment details link to their calendar date; related course resources are available in detail dialogs.
- Timetable status uses IST and updates every 30 seconds. Desktop keeps the weekly table; mobile uses a day selector and class list. Optional course, professor and class-type fields enrich new or edited classes.
- Database upgrades are additive and run automatically at startup. Existing records and attachments are preserved. Resource `kind` remains compatible with earlier data while `resourceType` records the more specific library category.

Run `npm test` for regression checks, including search, campus date boundaries, metadata validation, related-record behavior, and existing authentication/publishing tests. Run `npm run build` before serving production assets.
