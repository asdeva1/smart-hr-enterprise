# Staging set-up steps you do yourself

Three things need your own accounts. Nothing here should be pasted into chat; type each secret straight into
Vercel (Project, Settings, Environment Variables, Production, Sensitive on), then redeploy the API.

## 1. Private S3 bucket for documents

1. AWS console, S3, Create bucket. Name it, for example, `smartclues-hr-staging-docs`. Pick a region near your users
   (for India, `ap-south-1`). Leave **Block all public access** on. Turn **Bucket Versioning** on.
2. IAM, Policies, Create policy, JSON. Replace the bucket name:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject"],
         "Resource": "arn:aws:s3:::smartclues-hr-staging-docs/*"
       }
     ]
   }
   ```

3. IAM, Users, Create user `smart-hr-staging-storage` (no console access), attach that policy only.
4. Open the user, Security credentials, Create access key, "Application running outside AWS". Copy both values.
5. In Vercel on `smart-hr-api` add: `STORAGE_DRIVER` = `s3`, `S3_BUCKET`, `S3_REGION` (for example `ap-south-1`),
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (this last one Sensitive).
6. Redeploy. In the app upload a document, download it, and check it is still there after a redeploy.

Rotate this key if it is ever shown anywhere it should not be.

## 2. Outgoing email

If you already use Resend (as the other Smart Clues projects do), reuse it through its SMTP service: create a Resend API key
for this project, then set `SMTP_URL` to `smtps://resend:<API_KEY>@smtp.resend.com:465` and `MAIL_FROM` to an address on a domain
verified in Resend (for example `Smart HR <no-reply@smartcluestech.com>`). Skip the provider choice below.

Any SMTP service works. Common low-cost choices: Amazon SES (cheapest at scale, needs sender verification),
Brevo or Resend (free tiers, quick start). Whichever you choose:

1. Verify your sending domain (`smartcluestech.com`) with the DNS records the service shows (SPF and DKIM).
2. Create SMTP credentials. The connection string looks like `smtps://USER:PASSWORD@host:465`
   (URL-encode special characters in the password).
3. In Vercel add `SMTP_URL` (Sensitive) and `MAIL_FROM`, for example `Smart HR <no-reply@smartcluestech.com>`.
4. Redeploy, then use "Forgot password" on the sign-in page. The email should arrive within the sweep interval.

## 3. Reliable background sweeps

The free Vercel plan runs cron once a day, and GitHub's own scheduler can skip or delay runs. For emails and
webhooks within a minute or two, use one of:

- Upgrade the web/API projects to Vercel Pro and change the cron in `vercel.json` to every minute; or
- A free external pinger (for example cron-job.org): `GET https://<api-address>/api/cron` every 5 minutes with the
  header `Authorization: Bearer <CRON_SECRET>`. Keep the GitHub workflow as a backup.

## 4. After the first sign-in

- Delete the `BOOTSTRAP_*` settings (the password one first).
- Turn on MFA for the administrator.
- Keep `STARTUP_TASKS` and `PLATFORM_ADMIN_FIRST_OWNER` at `false`.
