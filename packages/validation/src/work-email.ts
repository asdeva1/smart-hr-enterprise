/**
 * Consumer mailbox providers. Self-service sign-up asks for a work address so each organisation is tied to a
 * company domain; people on these domains are asked to use their company email instead.
 * A short, conservative list: an unlisted domain is allowed, and an operator can still invite anyone.
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.in',
  'yahoo.co.in',
  'yahoo.co.uk',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'outlook.in',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'rediffmail.com',
  'yandex.com',
  'yandex.ru',
  'tutanota.com',
  'tuta.io',
  'fastmail.com',
  'hey.com',
  'inbox.com',
  'qq.com',
  '163.com',
  '126.com',
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
]);

/** The part after the last "@", lower-cased; empty when there is none. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0
    ? ''
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/** True for consumer and throwaway mailbox providers. */
export function isFreeEmailDomain(email: string): boolean {
  return FREE_EMAIL_DOMAINS.has(emailDomain(email));
}

export const WORK_EMAIL_MESSAGE = 'Please use your company email address, not a personal one.';
