// Run only on the owner's machine. Never place these credentials in VITE_* variables.
const required = name => { if (!process.env[name]) throw new Error(`Set ${name} in .env.drive`); return process.env[name]; };
const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: required('GOOGLE_CLIENT_ID'), client_secret: required('GOOGLE_CLIENT_SECRET'), refresh_token: required('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token' }) });
if (!response.ok) throw new Error(`Google authorization failed (${response.status}). Reconnect the owner account.`);
const { access_token } = await response.json();
const folder = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'StudentHub PDFs', mimeType: 'application/vnd.google-apps.folder' }) });
if (!folder.ok) throw new Error(`Folder creation failed (${folder.status}). Enable the Drive API.`);
const data = await folder.json();
console.log(`GOOGLE_DRIVE_FOLDER_ID=${data.id}\nFolder: ${data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`}`);
