# Buying a plan online (Razorpay)

Customers pick a plan on the website, pay in Razorpay's own window, and their organisation is created
automatically. Card details never reach this system.

## How it works

1. The website calls `POST /v1/checkout` with the plan, billing period, organisation, name and work email.
   The API prices the order from the live plan catalogue (the browser never says what it costs), opens an
   order with Razorpay and returns what the payment window needs.
2. The customer pays inside Razorpay's window.
3. Two messages can confirm the payment, and either is enough:
   - the browser: `POST /v1/checkout/confirm` (the signature is verified with the key secret);
   - Razorpay's own signed webhook: `POST /v1/billing/webhook` (verified with the webhook secret). It also
     arrives when the customer closes the window early.
4. Confirmation creates the organisation on an **active** subscription for the paid period, makes the buyer its
   owner, and emails them a link to set a password (or tells an existing user it is ready). The order is
   claimed first, so both messages together still create exactly one organisation.

A plan can be bought only when an operator has set an INR price for the chosen billing period; otherwise the API
answers `PRICE_NOT_AVAILABLE` and the website offers "Contact us".

## Settings (smart-hr-api, Production, Sensitive on for the secrets)

| Variable                  | Value                                                     |
| ------------------------- | --------------------------------------------------------- |
| `CHECKOUT_ENABLED`        | `true`                                                    |
| `RAZORPAY_KEY_ID`         | Key Id from Razorpay (**test mode** key on staging)       |
| `RAZORPAY_KEY_SECRET`     | Key Secret that goes with it                              |
| `RAZORPAY_WEBHOOK_SECRET` | A random string you choose; the same one goes in Razorpay |
| `SIGNUP_BLOCK_FREE_EMAIL` | `true` (default): work email addresses only               |

## Razorpay dashboard steps

1. Create a Razorpay account and stay in **Test mode** (switch at the top of the dashboard).
2. Settings, API Keys, Generate Test Key. Copy the Key Id and Key Secret into Vercel yourself.
3. Settings, Webhooks, Add new webhook:
   - URL: `https://<your API address>/v1/billing/webhook`
   - Secret: the same random string as `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured` and `order.paid`
4. Redeploy the API after saving the variables.
5. Pay with Razorpay's test card numbers (see their "Test cards" page). No real money moves in test mode.

Going live later means switching to Live keys, a new Live webhook with its own secret, and completing
Razorpay's business verification. That is a separate, deliberate step.

## Not covered yet

Tax (GST) lines on invoices, renewals and plan changes by the customer, refunds, and failed-payment
recovery. Renewals are currently recorded by an operator.
