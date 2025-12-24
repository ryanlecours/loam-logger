# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: security@loamlogger.com (or your preferred contact method)

You should receive a response within 48 hours. If for some reason you do not, please follow up to ensure we received your original message.

Please include the following information:

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the issue
- Location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

## Security Features

This application implements the following security measures:

### Authentication & Authorization
- Bcrypt password hashing (12 rounds)
- JWT tokens with short expiration (15 minutes access, 7 days refresh)
- Secure HTTP-only cookies for web clients
- Bearer token authentication for mobile clients

### Data Protection
- Prisma ORM for SQL injection prevention
- GraphQL type validation
- Environment variable separation
- No secrets in code or git history

### Network Security
- CORS configuration with explicit origin whitelist
- HTTPS enforced in production
- Secure cookie flags (httpOnly, secure, sameSite)
- Trust proxy configuration for Railway deployment

### API Security
- GraphQL introspection disabled in production
- Rate limiting on authentication endpoints (recommended)
- Input validation on all endpoints

## Best Practices for Contributors

If you're contributing to this project, please:

1. **Never commit secrets:**
   - Use environment variables for all sensitive data
   - Ensure `.env` files are in `.gitignore`
   - Check your commits before pushing: `git diff --cached`

2. **Follow secure coding practices:**
   - Use Prisma for all database queries (no raw SQL)
   - Validate all user input
   - Use TypeScript for type safety
   - Keep dependencies updated

3. **Before submitting a PR:**
   ```bash
   # Check for vulnerabilities
   npm audit

   # Run linting
   npm run lint

   # Run tests
   npm run test
   ```

4. **Security checklist:**
   - [ ] No secrets in code
   - [ ] Input validation added for new endpoints
   - [ ] Authentication/authorization checked
   - [ ] Error messages don't expose sensitive data
   - [ ] Dependencies are up to date

## Security Contacts

For security-related questions or concerns, please contact:
- **Email:** security@loamlogger.com
- **GitHub:** Create a private security advisory

## Acknowledgments

We appreciate the security research community's efforts in responsibly disclosing vulnerabilities. If you report a valid security issue, we'll acknowledge your contribution (with your permission) in our security advisories.

## Additional Resources

- [Security Audit Report](../SECURITY_AUDIT.md)
- [CI/CD Security Guide](../CI_CD_GUIDE.md)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Nx Security](https://nx.dev/recipes/other/security)
