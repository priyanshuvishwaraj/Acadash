# Shared data model

SQLite is stored at `server/data/hub.sqlite` by default. Each entity has its own table with prepared SQL statements. Schema initialization and one-time JSON import live in `server/database.js`.

## Tables

| Table | Fields | Purpose |
|---|---|---|
| `schedule` | `id`, `day`, `start`, `end`, `subject`, `room` | Monday = 1 through Sunday = 7. Times use `HH:mm`; one entry per day/start slot. |
| `assignments` | `id`, `title`, `subject`, `dueDate`, `description`, `pdfUrl`, `originalFileName`, `createdAt` | Shared coursework and PDF metadata. Due date is `YYYY-MM-DD`. |
| `events` | `id`, `title`, `date`, `type`, `description`, `startTime`, `endTime`, `location` | Single-day events. Types: `custom`, `test`, `exam`, `fest`, `holiday`. Time fields are optional, local IST `HH:mm`. |
| `announcements` | `id`, `title`, `body`, `createdAt` | Notices ordered newest first. Editing preserves the original publication timestamp. |
| `administrators` | `id`, `username`, `passwordHash` | Unique lowercase usernames and salted scrypt password hashes. |
| `sessions` | `tokenHash`, `adminId`, `expiresAt` | SHA-256 session token hashes; eight-hour expiry. Raw tokens only appear in HttpOnly cookies. |
| `metadata` | `key`, `value` | One-time import marker and timetable revision. |

All records belong to one shared campus. There are no student-owned copies. Assignment deadlines appear as derived `assignment` entries in the calendar; they are not duplicated in `events`.

## API

All reads are public. All content writes require an administrator cookie and enforce same-origin browser requests.

| Route | Methods | Notes |
|---|---|---|
| `/api/hub` | GET | Consistent snapshot of all four content tables plus `scheduleRevision`. |
| `/api/health` | GET | Service/database type status. |
| `/api/auth/session` | GET | Current admin, or null, plus whether admin access has been configured. |
| `/api/auth/login` | POST | Username/password. Rate-limited by connection IP. |
| `/api/auth/logout` | POST | Deletes session and clears cookie. |
| `/api/schedule` | GET, PUT | PUT accepts `{ entries, revision }`; stale revision returns 409. |
| `/api/schedule/render` | GET | Shared timetable SVG; frontend supports PNG download. |
| `/api/assignments` | GET, POST | POST multipart fields plus required `pdf`, maximum 15 MB. |
| `/api/assignments/:id` | PUT, DELETE | PUT multipart metadata with optional replacement PDF. |
| `/api/events` | GET, POST | Dates, type, optional start/end times, venue and description. |
| `/api/events/:id` | PUT, DELETE | Update or remove an event. |
| `/api/announcements` | GET, POST | Nonblank title and message required. |
| `/api/announcements/:id` | PUT, DELETE | Update or remove a notice. |

SQLite uses WAL mode, foreign keys, a busy timeout and transactions. Migration preserves original IDs and attachment URLs. Missing legacy event time/venue fields become empty strings. A failed import rolls back without setting the import marker.
