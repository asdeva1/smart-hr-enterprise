/**
 * The pg driver already treats sslmode prefer, require and verify-ca as verify-full and warns that this will
 * change in a future major version. Saying verify-full out loud keeps today's (strict) behaviour whatever the
 * driver does later, and silences the warning. Other modes and connection strings without sslmode are untouched.
 */
export function withExplicitSslMode(connectionString: string): string {
  return connectionString.replace(/([?&]sslmode=)(?:prefer|require|verify-ca)(?=&|$)/, '$1verify-full');
}
