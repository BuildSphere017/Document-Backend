# MAKPHALT DMS API — Endpoint reference

Base URL: `http://localhost:4000/api`
Auth: send `Authorization: Bearer <accessToken>` (from `POST /auth/login`).

Roles: **ADMIN**, **MANAGER**, **SALES**.

---

## Health
`GET /health` → `{ status: "ok", ts }` — no auth.

---

## Auth

### `POST /auth/login`  — public (rate-limited)
```json
{ "username": "rishabh", "password": "ChangeMe123!" }
```
→ `200`
```json
{
  "accessToken": "eyJhbGc…",
  "user": { "id": "…", "fullName": "Rishabh Jaini", "username": "rishabh", "role": "ADMIN", … }
}
```

### `GET /auth/me`  — any authenticated user
Returns the current user profile.

### `POST /auth/logout`  — any authenticated user
Stateless — client discards the token. `{ "success": true }`.

---

## Dashboard

### `GET /dashboard/overview`  — any authenticated user
Returns stats, category distribution, storage trend, recent uploads, most viewed/
downloaded, and recent activity. SALES users only see documents in categories they
have permission to view.

---

## Users  *(ADMIN only — this is the admin panel API)*

### `GET /users`
List all users with permissions and document counts.

### `POST /users`
```json
{
  "fullName": "Arun Joshi",
  "username": "arunjoshi",
  "password": "Sales123!",
  "email": "arunjoshi@makphalt.com",   // optional
  "role": "SALES",                       // ADMIN | MANAGER | SALES
  "department": "Sales",                 // optional
  "categoryIds": ["cat_id_1", "cat_id_2"]
}
```

### `PATCH /users/:id`
Any subset of: `fullName`, `email`, `role`, `department`, `status`, `categoryIds`.

### `POST /users/:id/disable`  ·  `POST /users/:id/enable`
Toggle account status.

### `POST /users/:id/reset-password`
```json
{ "password": "NewPass123!" }
```

### `DELETE /users/:id`
Soft-delete (cannot delete your own account).

---

## Categories

### `GET /categories?includeArchived=false`  — any authenticated user
List categories with document counts.

### `POST /categories`  — ADMIN / MANAGER
```json
{ "name": "Warranty Docs", "color": "#2563EB", "icon": "shield", "description": "…" }
```

### `PATCH /categories/:id`  — ADMIN / MANAGER
Any subset of: `name`, `color`, `icon`, `description`, `archived`, `sortOrder`.

### `DELETE /categories/:id`  — ADMIN / MANAGER
Soft-delete. Rejected (409) if the category still contains documents.

---

## Activity

### `GET /activity?action=DOWNLOAD&limit=50&cursor=<id>`  — ADMIN / MANAGER
Cursor-paginated activity feed. `action` is optional
(UPLOAD | DOWNLOAD | VIEW | SHARE | DELETE | LOGIN | AI_SEARCH | LINK_VIEW | EXPORT).
→ `{ "items": [...], "nextCursor": "…" | null }`

---

## Error shape
All errors return:
```json
{ "message": "Human-readable message", "details": [ … ] }  // details only for validation
```
Status codes: `400` validation · `401` unauthenticated · `403` forbidden ·
`404` not found · `409` conflict · `429` rate-limited · `500` server error.
