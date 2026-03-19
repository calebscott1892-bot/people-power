# Email Service Documentation

## Overview

People Power uses a centralized email service for sending transactional emails. The system supports dual providers:

- **Resend API** (recommended for production)
- **SMTP** (for self-hosted deployments)

Email is non-blocking: failures are logged but don't break route logic. In development, unconfigured email is logged to the console.

## Configuration

### Environment Variables

```env
# Sender email address (used for all outbound emails)
EMAIL_FROM=noreply@peoplepower.example.com

# Admin alert recipients for critical notifications (comma-separated)
# Example: ADMIN_ALERT_EMAIL=admin1@example.com,admin2@example.com
ADMIN_ALERT_EMAIL=admin@example.com

# Report email sender (can differ from EMAIL_FROM for user-facing communications)
REPORT_EMAIL_FROM=reports@peoplepower.example.com

# Optional: Reply-to address for replies
REPORT_EMAIL_REPLY_TO=support@peoplepower.example.com

# Email Provider: Resend (preferred)
# Get API key from https://resend.com
RESEND_API_KEY=your-resend-api-key

# Email Provider: SMTP (alternative)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
# Also supported by Server/email.js:
# SMTP_PASSWORD=your-smtp-password
SMTP_SECURE=true  # Use TLS/SSL (recommended)
```

### Email Provider Selection

The system tries providers in this order:

1. **Resend API** (if `RESEND_API_KEY` is set)
2. **SMTP** (if `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` are set)
3. **Disabled** (if neither is configured)

### Development Setup

#### Using Mailtrap (Free Test Service)

[Mailtrap](https://mailtrap.io) provides a free sandbox SMTP server for testing email without sending real emails:

```env
SMTP_HOST=live.smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=your-mailtrap-username
SMTP_PASS=your-mailtrap-password
SMTP_SECURE=true
```

**Note:** In development, if email is not configured, emails are logged to the console instead of failing.

#### Testing via API

Use the test endpoint to verify your email configuration:

```bash
# Send test email to REPORT_EMAIL_FROM address
curl -X POST http://localhost:3001/debug/send-test-email

# Send test email to a specific address
curl -X POST http://localhost:3001/debug/send-test-email \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com"}'
```

Response (on success):
```json
{
  "ok": true,
  "messageId": "resend_xyz123...",
  "message": "Test email sent to test@example.com"
}
```

Response (on failure):
```json
{
  "ok": false,
  "error": "Email service not configured",
  "detail": "Check server logs for details"
}
```

**Only available in development** (`NODE_ENV !== 'production'`).

### Production Setup

1. Choose a provider:
   - **Resend** (SaaS, simple): Get API key at https://resend.com, set `RESEND_API_KEY`
   - **SMTP** (self-hosted): Configure SMTP credentials for your email service (AWS SES, SendGrid, etc.)

2. Set environment variables in production deployment
3. Monitor logs for email failures

## Email Triggers

### Report Submission (`POST /reports`)

When a user submits a report:
- **To admins**: Best-effort alert email to `ADMIN_ALERT_EMAIL` (comma-separated). Failures are logged and never block the API response.
- **To reporter**: Not currently wired (templates exist but sending is not hooked up).

### Report Resolution (`POST /reports/:id`)

When a report status changes to "resolved":
- **To reporter**: Notification that their report was reviewed
- **Provider**: Resend API or SMTP (non-blocking)
- **Template**: `buildReportResolvedEmail()`

### Messages (`POST /conversations/:id/messages`)

When a user sends a message in a conversation:
- **To recipients**: Notification of new message (if opted-in)
- **Filtering**: Only sent to recipients who have `email_notifications_opt_in = true` in `user_profiles`
- **Provider**: Async (non-blocking, logged if failed)
- **Template**: `buildMessageNotificationEmail()`

### Collaboration Invites (`POST /movements/:id/collaborators`)

When a user is invited to collaborate on a movement:
- **To invitee**: Invitation email with movement details
- **Filtering**: Only sent to recipients who have `email_notifications_opt_in = true`
- **Provider**: Async (non-blocking, logged if failed)
- **Template**: `buildCollaborationInviteEmail()`

### Movement Deletion (`DELETE /movements/:id`)

When a movement is deleted by owner/admin:
- **To participants**: Notification that the movement was deleted
- **Filtering**: All verified participants (no opt-in check; considered critical)
- **Provider**: Async (non-blocking, failures logged)
- **Template**: `buildMovementDeletedEmail()`

## Implementation

### Email Module (`Server/email.js`)

Main exports:

```javascript
// Initialize module with Fastify reference
emailService.setFastifyRef(fastify)

// Check if email is configured
const ready = emailService.canSendEmail()  // returns boolean

// Send email (blocking, with error handling)
const result = await emailService.sendAppEmail({
  to: 'recipient@example.com',
  subject: 'Email Subject',
  text: 'Plain text body',
  html: '<p>HTML body</p>'
})
// returns { ok: boolean, messageId?: string, error?: string }

// Send email without blocking main request
void emailService.sendAppEmailAsync({ to, subject, text, html })
// Returns promise, but route doesn't wait
```

### Integration in Routes

Routes use `emailService.sendAppEmailAsync()` for fire-and-forget emails:

```javascript
// After core logic succeeds, send email in background
void emailService.sendAppEmailAsync({
  to: userEmail,
  subject: 'Notification',
  text: 'Plain text',
  html: '<p>HTML</p>'
});
```

Helper functions like `notifyMessageRecipients()` use `await emailService.sendAppEmail()` internally.

## Error Handling

### Development (`NODE_ENV !== 'production'`)

- If email is unconfigured: logs to console (no failure)
- If send fails: error logged, route continues

### Production (`NODE_ENV === 'production'`)

- If email is unconfigured: returns error, but doesn't block routes
- If send fails: error logged, route continues
- **Important**: Email failures are non-blocking and never break core functionality

## Email Opt-In

Users can control email notifications via `user_profiles.email_notifications_opt_in`:

- **true**: Receive transactional emails (messages, invites, etc.)
- **false**: Skip email notifications (still receive critical emails like movement deletion)

Queries filter by this flag:

```javascript
const optedIn = await listEmailNotificationRecipients(emailList)
// Returns only emails where email_notifications_opt_in = true
```

## Testing

### Unit Testing Email Module

```javascript
// Test that canSendEmail works
const ready = emailService.canSendEmail()
expect(ready).toBe(process.env.RESEND_API_KEY || process.env.SMTP_HOST)

// Test sendAppEmail with mock credentials
// (configure SMTP or RESEND_API_KEY in test env)
```

### Integration Testing Routes

1. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` to Mailtrap credentials
2. Trigger email events (create report, invite collaborator, etc.)
3. Check Mailtrap inbox for sent emails

## Troubleshooting

### "Email not configured" in logs

**Solution**: Set either `RESEND_API_KEY` or `SMTP_*` variables

### "Email send failed" in logs

**Resend**:
- Check `RESEND_API_KEY` is valid
- Verify sender address matches Resend domain settings

**SMTP**:
- Test SMTP credentials with telnet: `telnet SMTP_HOST SMTP_PORT`
- Check firewall allows outbound SMTP (port 587 or 465)
- Verify username/password are correct
- Confirm `SMTP_SECURE=true` if using port 465, `false` for 587 with STARTTLS

### No emails in development

In development, unconfigured email is logged to the console. Check server logs instead of email inbox:

```
[email-unconfigured] To: user@example.com, Subject: Your notification...
```

## Database Schema

Email notification preference is stored in `user_profiles`:

```sql
CREATE TABLE user_profiles (
  -- ... other fields ...
  email_notifications_opt_in BOOLEAN DEFAULT true,
  -- ... other fields ...
);
```

Users who set this to `false` will not receive:
- Message notifications
- Collaboration invites
- Other opt-in emails

They **will still receive**:
- Report receipts/resolutions (transactional)
- Movement deletion notices (critical)

## Future Improvements

- [ ] Email template versioning for A/B testing
- [ ] Detailed email analytics (open, click tracking)
- [ ] Scheduled/delayed email sending
- [ ] Bulk email for newsletters
- [ ] Email preference center for users
- [ ] Bounce/complaint handling
