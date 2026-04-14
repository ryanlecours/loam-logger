import * as React from "react";
import { PasswordSecurityEmailBase, PasswordSecurityEmailProps } from "./password-security-base";

export const PASSWORD_CHANGED_TEMPLATE_VERSION = "1.0.2";

export default function PasswordChangedEmail(props: PasswordSecurityEmailProps) {
  return (
    <PasswordSecurityEmailBase
      {...props}
      config={{
        previewText: "Your Loam Logger password has been changed",
        heading: "Your password was changed",
        bodyText: (safeEmail) =>
          `The password for your Loam Logger account (${safeEmail}) was recently changed.`,
        warningText: "your account may be compromised. Please contact us immediately at",
        confirmationText:
          "If you made this change, no action is needed. Your new password is now active.",
      }}
    />
  );
}

/**
 * Get the password changed email subject line.
 */
export function getPasswordChangedEmailSubject(): string {
  return "Your Loam Logger password was changed";
}

/**
 * Build the React element for the password-changed email.
 * Keeping the JSX in the template module lets consumer service files stay .ts.
 */
export function buildPasswordChangedEmailElement(props: PasswordSecurityEmailProps) {
  return <PasswordChangedEmail {...props} />;
}
