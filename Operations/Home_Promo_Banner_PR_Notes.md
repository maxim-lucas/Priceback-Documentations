# Home promo banner: PR notes

## Old app builds

- New routes are additive: `GET /api/me/home-promo` is behind the `home-promo` cap (`X-App-Caps`); a build without the
  cap gets the same 404 as any unknown path. No existing route, request field or response field changes.
- The promo-code route (`/api/me/promo-code`) is unchanged and unaffected for old builds.
- The admin routes (`/api/admin/home-promo*`) are admin-only. The push carries a new registry type and a mobile routing
  line; builds before 3.6.5 are never pushed (`old_or_unknown_build`), and an unknown type only opens the app on older builds (it does NOT open Home).
- Migration 0068 is a new table (`home_promo_pushes`), additive; applied to prod before the deploy.

## Cost

- Banner route: one tiny authenticated GET per Home focus, only from builds that send the `home-promo` cap; a single
  config read (cached snapshot), the account read (`getBySub`), the notification-prefs read and at most one `everSubscribed`
  read per Home focus; no external call. The admin desk and the push read the row fresh from the database instead.
- Push: sent only on Maxim's approval, once per campaign; no scheduler, no cron. One `sendUserPush` per recipient (about 4 DB reads and one Expo call each, 4 at a time, inside the request), so a send takes
  as long as the audience is large; a preview with nobody to send to issues no token.
