import { gql } from '@apollo/client';

// Kept out of ME_QUERY on purpose: if the web deploy lands before the API
// that knows this field, only the banner fails (and hides), not the app.
export const EMAIL_VERIFICATION_STATUS = gql`
  query EmailVerificationStatus {
    me {
      id
      email
      needsEmailVerification
    }
  }
`;
