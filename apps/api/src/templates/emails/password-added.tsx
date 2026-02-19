import * as React from "react";
import { PasswordSecurityEmailBase, PasswordSecurityEmailProps } from "./password-security-base";

export const PASSWORD_ADDED_TEMPLATE_VERSION = "1.0.2";

export default function PasswordAddedEmail(props: PasswordSecurityEmailProps) {
  return (
    <PasswordSecurityEmailBase
      {...props}
      config={{
        previewText: "A password has been added to your Loam Logger account",
        heading: "Password added to your account",
        bodyText: (safeEmail) =>
          `A password has been added to your Loam Logger account (${safeEmail}). You can now sign in using either Google or your email and password.`,
        warningText: "please contact us immediately at",
        confirmationText:
          "If you made this change, no action is needed. You can now use your password to sign in on any device.",
      }}
    />
  );
}

/**
 * Get the password added email subject line.
 */
export function getPasswordAddedEmailSubject(): string {
  return "Password added to your Loam Logger account";
}
