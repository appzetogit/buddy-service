# Cash deposit - abandoned attempts and retry (Flutter rider/driver app)

Base URL `https://sooperbuddy.in/api/v1`. Backend is live. This is a **small follow-up** to the deposit flow in `flutter-cod-and-cash-complete-guide.md` (section B4/B5). Read that first; only the differences are below.

## What was wrong
A rider opened the deposit sheet (the server creates a Razorpay order and a **Pending** deposit), closed Razorpay without paying, and later deposited again successfully. The admin panel then showed the old attempt as "Pending" forever next to the "Completed" one. No money was lost or doubled; it was only a stale row.

## What the backend does now
1. When the rider starts a **new** deposit (`POST /food/delivery/wallet/deposit/order`), every earlier attempt of that rider that was **never paid** is closed automatically: status becomes **`Failed`** with `note: "Not paid - replaced by a new attempt"`.
2. If someone still pays one of those old orders later (e.g. a Razorpay sheet left open), the deposit is **completed** anyway (via `deposit/verify`, or the Razorpay captured webhook) and cash in hand drops correctly. A `Failed` row can therefore turn into `Completed`.
3. Cash in hand only ever drops for `Completed` deposits. `Pending` and `Failed` never change it.

## What the Flutter app must do

### 1. Always start a fresh order on retry
Every time the rider taps **Deposit cash**, call `POST /food/delivery/wallet/deposit/order` again and use the **new** `razorpay.orderId`. Never reuse an old order id from a previous screen/session.

### 2. Deposit history (`GET /food/delivery/wallet/deposits`)
Rows can now be `Pending`, `Completed` or `Failed` (as before), but `Failed` rows with `note == "Not paid - replaced by a new attempt"` are just abandoned attempts. Recommended display:
| status | note | Show |
|---|---|---|
| `Completed` | - | green chip "Completed" |
| `Pending` | - | amber chip "Processing" (only the latest attempt can be pending) |
| `Failed` | `Not paid - replaced by a new attempt` | **hide it**, or a grey chip "Not completed" |
| `Failed` | anything else (payment failed / verification failed) | red chip "Failed" |
Do not show a "Retry" on old rows; the rider just taps **Deposit cash** again.

### 3. App closed or crashed during payment
If Razorpay returned success but the app died before calling `deposit/verify`, do nothing special: on next open call `GET /food/delivery/cash-summary` and `GET /food/delivery/wallet/deposits`. The Razorpay webhook completes the deposit on the server, so cash in hand will already be reduced. Only if you still hold the three Razorpay ids locally, you may call `POST /food/delivery/wallet/deposit/verify` (safe to repeat, it never double-counts).

### 4. After a deposit
Refresh `cash-summary` (cash in hand, available, blocked). A blocked rider starts receiving jobs again as soon as cash in hand is below the limit.

### 5. Label for the per-service numbers
`cash-summary.byService.*.collected` is the **total cash collected so far** (all time), not what the rider holds now. After a full deposit the rider's cash in hand is 0 while the service chips still show the totals. Label them **"Total collected"** (not "Cash in hand"). The amount the rider actually holds is `summary.cashInHand`.

## No change needed
- Request/response shapes of `deposit/order`, `deposit/verify`, `wallet/deposits`, `cash-summary`.
- Limits, blocking and enforcement rules.

## QA
1. Tap Deposit, close Razorpay without paying, tap Deposit again and pay -> history shows one Completed (the unpaid one is hidden / "Not completed"), cash in hand drops once.
2. Pay, kill the app before verify, reopen -> cash in hand already reduced after a refresh.
3. Failed card payment -> row is `Failed` (red) and cash in hand unchanged; a new attempt works.
4. After a full deposit the service chips still show totals and are labelled "Total collected".
