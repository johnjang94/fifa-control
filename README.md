# FIFA Control

Backend service for invite storage and admin reads.

It exposes the `invite_requests` collection through `/api/invites`.
It also exposes `/api/settings` for admin-managed invite capacity.

## Local setup

1. Copy `.env.example` to `.env.local`
2. Fill in the Firebase Admin credentials
3. Run `npm run dev`

Allowed clients:

- `fifa-half-time-show`
- `fifa-admin`
