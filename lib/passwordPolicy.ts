/**
 * Enforces a strong password policy.
 * Returns an error string if invalid, null if valid.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 10) {
    return "Password must be at least 10 characters.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number.";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must contain at least one special character (!@#$%^&* etc).";
  }

  // Block common weak passwords
  const WEAK = [
    "password", "password1", "password123", "12345678", "qwerty",
    "abc123", "letmein", "welcome", "monkey", "dragon", "admin",
    "iloveyou", "sunshine", "master", "passw0rd", "cabinet",
    "cabinets", "jkcabinets", "jkorders",
  ];
  if (WEAK.some(w => password.toLowerCase().includes(w))) {
    return "Password is too common or easy to guess. Choose something more unique.";
  }

  return null;
}
