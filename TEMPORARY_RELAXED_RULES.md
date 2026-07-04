# Temporary Relaxed Rules

These backend checks are intentionally relaxed for current app integration and should be restored when the matching UI flows are ready.

- Activation currently does not require `background_check` or `training`.
- Training and quiz are hidden from the rider onboarding checklist; riders can complete them later.
- Bank account holder name is not required to match the rider profile name.

Keep strict validation for account number, IFSC, UPI format, documents, and profile data.
