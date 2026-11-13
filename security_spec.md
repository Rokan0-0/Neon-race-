# Security Specification: Apex Moto Multiplayer

## 1. Data Invariants
1. **Verified Auth Required**: All Firestore reads and writes require `request.auth != null && request.auth.token.email_verified == true`.
2. **No PII Storage**: Only `uid` and public `displayName` are stored in `/races` and `/records` (never email, phone, or address).
3. **Bounded Arrays**: `memberUids` and `standings` on `/races` are strictly bounded to `1..4` elements.
4. **Immutable Race Logs**: Completed `/races/{raceId}` documents cannot be updated or deleted once recorded.
5. **Owner-Scoped Records**: `/records/{recordId}` documents are keyed `{uid}_{trackId}` and can only be created or updated by `request.auth.uid == uid`.

## 2. Adversarial Payloads Covered
- Unauthenticated read/write -> `PERMISSION_DENIED`
- Identity spoofing (`hostUid` or `uid != request.auth.uid`) -> `PERMISSION_DENIED`
- Shadow/ghost fields -> `PERMISSION_DENIED` via `keys().hasOnly(...)`
- Array overflow (`> 4` players) -> `PERMISSION_DENIED`
- Blanket `/races` scraping without `memberUids` filter -> `PERMISSION_DENIED`
- Mutating or deleting completed `/races` -> `PERMISSION_DENIED`
- Client timestamp forgery (`createdAt` / `updatedAt != request.time`) -> `PERMISSION_DENIED`
