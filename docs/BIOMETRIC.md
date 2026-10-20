# Biometric attendance machines (eSSL and other ZKTeco-based devices)

Machines push their scans to the server (the "ADMS" / cloud-server feature). Nothing is pulled from the
machine, so it works from a serverless host.

## Setting up

1. Attendance → Biometric → **Add a machine**, using the serial number from the machine (Menu → System Info) and
   the time zone its clock is set to.
2. On the machine: Menu → Comm. → Cloud Server Setting. Server address = the site's host name, port 443, HTTPS on.
   The machine calls `/iclock/cdata`, `/iclock/getrequest` and `/iclock/devicecmd` on that host.
3. Link each person's **User ID** (the number they were enrolled with) to their employee record. Scans from a
   user ID that isn't linked yet are kept as "waiting" and counted the moment it is linked.

## How scans become attendance

- A machine is recognised only by a registered, active serial number. Unknown or archived machines get `404`.
- Each upload is stored as received. Uploading the same scan again changes nothing.
- The first scan of an employee's day is a clock-in, the next a clock-out, and so on, whatever in/out label the
  machine gives (most machines don't set it reliably). Two scans within a minute count once.
- Times are the machine's local clock, read in the time zone set on the machine's record.
- Scans from people who have left, or dated more than ten minutes ahead (a wrong machine clock), aren't counted.
- Errors in a day are fixed the usual way: a correction request.

## Limits

- Machines with older firmware that can only speak plain HTTP can't connect to an HTTPS-only host.
- A machine identifies itself by serial number alone (the protocol has no login), so treat serial numbers as
  semi-private.
