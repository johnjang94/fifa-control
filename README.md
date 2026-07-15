# FIFA Control

Backend service for invite storage and admin reads.

It exposes the `invite_requests` collection through `/api/invites`.
Deleting an invite now also removes related support chat inquiries from `support_chat_inquiries`.
For manual Firestore deletions, deploy the Firebase Functions trigger in `firebase-functions/index.js` so related inquiries and profile photos are cleaned up automatically.
For catch-up cleanup, call `POST /api/admin/maintenance/reconcile` with the admin key to remove orphaned inquiries.
It also exposes `/api/settings` for admin-managed invite capacity.
Support chat tickets are stored in `support_chat_inquiries`, and Twilio SMS alerts can be enabled with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `SUPPORT_ALERT_TO_NUMBER`.
New guest registrations can notify the admin phone number with `ADMIN_ALERT_TO_NUMBER`.
Admin login checks `admin_users` for `role: "manager"` or `role: "operator"` and `active: true`.
Profile photos are stored in Firebase Storage. Set `FIREBASE_STORAGE_BUCKET` if you do not want to use the default `${FIREBASE_PROJECT_ID}.appspot.com` bucket.

## Local setup

1. Copy `.env.example` to `.env.local`
2. Fill in the Firebase Admin credentials
3. Run `npm run dev`

Allowed clients:

- `fifa-half-time-show`
- `fifa-admin`
