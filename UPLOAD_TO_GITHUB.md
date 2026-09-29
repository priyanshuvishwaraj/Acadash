# Upload this folder to GitHub

Upload the CONTENTS of this folder to your repository root, not the github-upload folder itself.
The repository root must contain package.json, client/, supabase/, and .github/.
Include the hidden .github folder, .gitignore, and .env.example. Check that GitHub shows
.github/workflows/pages.yml after uploading. GitHub Desktop is convenient for preserving
all directories and hidden files. If using the browser, drag the files and subfolders
into Add file > Upload files; do not upload a ZIP as a substitute for the source files.

Before the first successful deployment:

1. Complete docs/CLOUD_SETUP.md to configure Google Drive, Supabase and administrator access.
2. In repository Settings > Secrets and variables > Actions > Variables, add
   VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (public values only).
3. In Settings > Pages, choose GitHub Actions as the source.
4. Use the main branch, or change the branch in .github/workflows/pages.yml.
5. Run the Deploy static campus hub workflow from Actions if the initial run failed
   before you configured the variables.

Google secrets belong in Supabase Edge Function secrets, never in the public frontend.
Supabase migrations and the Edge Function are deployed separately following the guide;
GitHub Pages deploys only the frontend.

Local credentials, databases, uploaded PDFs, node_modules, and generated builds were
excluded. Server source and tests are included because the workflow runs the regression
suite. GitHub Pages does not run the local Express server.

This folder is a snapshot of the app. Later edits to the original project are not
copied here automatically.
