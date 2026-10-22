/** Where the application lives. Sign-in and the app links on this site go there. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://smart-hr-web.vercel.app').replace(
  /\/+$/,
  '',
);

export const SITE_NAME = 'SmartHRMS';
