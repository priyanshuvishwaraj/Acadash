# Set up Supabase + Google Drive + GitHub Pages

The cloud frontend is a static site. Supabase provides the public data, administrator
login, preview-image storage and a protected `hub` Edge Function. PDFs are owned by
your Google account. Students never authenticate with Google.

## 1. Accounts you can create now

1. Create a dedicated Google account for the hub (or use an existing account you
   intend to maintain). Enable account recovery and two-step verification.
2. Create a project at [Supabase](https://supabase.com/dashboard). Pick a nearby
   available region and save the database password in your password manager.
3. Have a GitHub account and repository ready. Do not upload `.env` files, the
   local SQLite database, or Google credentials. GitHub Pages publishes only
   `client/dist`, not the server or source secrets.

Do not buy Hostinger for this deployment. Google Workspace is not required.

## 2. Supabase schema and administrators

In Supabase's SQL Editor, run the contents of
`supabase/migrations/202609290001_cloud_hub.sql` once on the new project.
Alternatively use the CLI migration command below, but do not use both methods.
It creates the public snapshot, private upload registry, administrator allowlist,
transactional update function and public `previews` bucket.

In Authentication settings disable public user signups. In Authentication → Users,
create an email/password user with email confirmed. Copy that user's UUID and run:

```sql
insert into public.hub_admins(user_id) values ('PASTE_AUTH_USER_UUID');
```

Repeat for additional administrators. Being signed in alone does not grant editing
rights; the UUID must be in this table. Never allow users to add themselves.
Students need no account. Your old local usernames/passwords do not migrate.

From project settings, copy the project URL and **publishable** API key (the legacy
`anon` key also works). Put only these public values in a root `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Both values are required to select cloud mode. With neither set, the existing local
Express/SQLite version continues to work. Restart Vite after changing them.

## 3. Connect the PDF-owner Google account

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a
   project. Enable **Google Drive API** in its API Library.
2. Configure Google Auth Platform/OAuth consent: give the app a name and contact
   email, use External audience for a personal account, and add the owner account
   as a test user while setting up.
3. Add the scope `https://www.googleapis.com/auth/drive.file`. This grants access
   to files created by this app, instead of the account's entire Drive.
4. Create an OAuth client with application type **Web application**. Set its
   authorized redirect URI to `https://developers.google.com/oauthplayground`.
   Save its client ID and client secret privately.
5. For ongoing use, change the consent app's publishing status to **Production**
   before obtaining the final refresh token. External apps left in Testing issue
   Drive refresh tokens that expire after seven days. Follow any requirements
   shown by Google's console; do not assume changing status removes all checks.
6. Open [OAuth Playground](https://developers.google.com/oauthplayground). In the
   settings gear, select **Use your own OAuth credentials**, enter your client ID
   and secret, and use offline access with consent prompting.
7. Enter the `drive.file` scope above, authorize using the **PDF-owner account**,
   then exchange the authorization code for tokens. Save the refresh token.
   Do not use the Playground's default OAuth client credentials.

Create a private root file `.env.drive` (already ignored by Git):

```dotenv
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN=YOUR_REFRESH_TOKEN
```

Create the storage folder **through the same OAuth app**, so the limited scope can
access it. Run this once from the project root:

```powershell
node --env-file=.env.drive scripts/create-drive-folder.js
```

The command prints a `GOOGLE_DRIVE_FOLDER_ID` and folder link, but no credentials.
Add that ID to `.env.drive`. Do not substitute a manually created folder: the
`drive.file` scope may not have access to it. The folder itself can stay private;
each uploaded PDF gets its own anyone-with-link Viewer permission.

Also add to `.env.drive`:

```dotenv
ALLOWED_ORIGINS=http://localhost:5173,https://YOUR_USERNAME.github.io
CLEANUP_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
```

Origins contain scheme and hostname (and local port), but **no repository path or
trailing slash**. Add your custom-domain origin if you use one. Generate the cleanup
secret with a password manager. Never put any of these secrets in `VITE_*` variables.

## 4. Deploy the backend

Using Node 22.19+ in the project root:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
# Only if you did NOT run the migration manually in SQL Editor:
npx supabase db push
npx supabase secrets set --env-file .env.drive
npx supabase functions deploy hub
```

`supabase/config.toml` disables gateway JWT checking for this function because the
function explicitly verifies tokens with Supabase Auth and checks `hub_admins`.
It never trusts a browser-provided admin flag. Supabase supplies the server's
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; keep that service key out of the site.

## 5. Schedule failed-upload and deletion cleanup

Successful writes immediately attempt cleanup. Failed deletes remain in
`hub_assets` with state `pending` and a diagnostic `last_error`. Uploads interrupted
before publishing become eligible for cleanup after 24 hours.

Set up the following hourly job so cleanup continues even when no administrator
is editing. Enable **pg_cron** and **pg_net** in Supabase's Extensions/Integrations
settings. In **Vault**, create secrets named:

- `hub_project_url`: `https://YOUR_PROJECT_REF.supabase.co`
- `hub_cleanup_secret`: the same value as `CLEANUP_SECRET` in Edge Function secrets

Then run this once in SQL Editor:

```sql
select cron.schedule('hub-file-cleanup', '17 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='hub_project_url') || '/functions/v1/hub',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name='hub_cleanup_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
```

Check the function logs and `hub_assets` for repeated failures. Reconnect Google
if its authorization is revoked. If a file delete fails, its existing public Drive
link may still work until cleanup succeeds. Permanent deletion cannot be undone.
The job processes bounded batches; large backlogs may take several runs.

## 6. Verify locally before publishing

```powershell
npm install
npm run dev:client
```

Open `http://localhost:5173`. No local Express process is needed in cloud mode.

1. Read the empty hub signed out; sign in with the Supabase administrator email.
2. Create a course, announcement, event and timetable entry. Check them in a
   signed-out window. Try an unapproved Auth account: editing must be denied.
3. Upload a small, unencrypted PDF assignment. Verify its first-page image,
   public Drive link (in a signed-out window), and presence in the owner folder.
4. Edit only its title: its PDF and preview must stay unchanged.
5. Replace the PDF: verify the new preview and link, and that the old Drive file
   is removed. Delete the item: verify both Drive file and preview are removed.
6. Edit a timetable in two windows: the stale save must report a conflict.
7. For a staging project, test a revoked Drive connection, then reconnect and
   verify cleanup retries. Do not treat a saved record as proof cleanup succeeded.

Uploads are limited to 15 MB and previews to 256 KB. Password-protected or corrupt
PDFs that cannot render are rejected before upload. Current uploads are proxied
through the Edge Function; unusually slow uploads can hit its runtime limit.
Rendering runs in the administrator browser, not on the function's CPU budget.

## 7. Publish the static site

In GitHub repository Settings → Secrets and variables → Actions → **Variables**,
add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` with the same public
values used locally. Do not add Google credentials to the website build.

Set Settings → Pages → Source to **GitHub Actions**. The included
`.github/workflows/pages.yml` builds and publishes on pushes to `main` or manual
dispatch. If your default branch has another name, update the workflow first.
The relative Vite asset base and existing hash routes support repository subpaths.

## Existing data and operating limits

Your local SQLite database and uploaded PDFs are preserved. Cloud mode starts with
an empty database; existing content is **not automatically migrated**. Keep a backup
of `server/data` and `server/uploads`. For a small existing hub, recreate the courses,
events and notices and re-upload PDFs through the new UI. Do not copy local
`/uploads/...` URLs into the cloud database; GitHub Pages cannot serve those files.

The snapshot format preserves whole-hub search. Browsers cache it and check a tiny
revision response every five minutes while visible, and on window focus. They fetch
the full snapshot only after a change. This suits a small campus hub; a large archive
would benefit from paginated database tables and server-side search in a later change.
New images use unique names, lazy loading and long cache lifetimes.

Free-tier storage/egress/runtime limits and inactivity pausing still apply. Preview
images and PDF uploads relayed to Drive consume Supabase resources. Keep periodic
database exports and separate backups of PDFs; this integration is not a backup.

References: [Google OAuth](https://developers.google.com/identity/protocols/oauth2),
[Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[Supabase secrets](https://supabase.com/docs/guides/functions/secrets),
[Scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions).
