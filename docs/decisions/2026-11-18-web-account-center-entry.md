# Decision: Account Center entry in HomeMew Web navigation

Date: 2026-11-18
Status: Owner requested; Preview acceptance pending.

- Clicking the entire user area (avatar/name) in the desktop sidebar footer or mobile More account card opens the existing LifeSpace Account Center, new tab, with visible 账户中心 label and external-link affordance. No second personal settings implementation.
- Match LifeSpace Console environment routing: Production https://account.aisr.online/center#account, Staging https://account-staging.aisr.online/center#account. The existing authenticated Web session response adds only the fixed accountCenterUrl derived from trusted Worker ENVIRONMENT. Unknown/local environments get null, not Production fallback. Browser query, origin/host and user-provided URL cannot choose target. UI accepts only the two known URLs and retains inactive account display before session is available.
- No credential, user ID or family ID passed to Account; its own Access session and Identity/Core authorization remain authoritative. No added API request or D1 query for entry rendering; navigating to Account loads its normal page. No platform, Mini Program or new persistent state. Owner-controlled Preview and separate Production gate remain.
