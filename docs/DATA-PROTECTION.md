# Data protection and recovery

Project `YOUR_PROJECT_ID`, region `YOUR_REGION`.

## What is protected

| Data | Protection |
|---|---|
| Cloud SQL `YOUR_SQL_INSTANCE` (stock, sales, invoices, machine sales, ledgers, staff) | Daily automated backup (14 kept), point-in-time recovery for 7 days, deletion protection on |
| Firestore (user accounts, customers, suppliers, warranties) | Point-in-time recovery (7 days), daily backup kept 14 days, weekly backup kept 8 weeks, deletion protection on |
| Whole-database file | Owner dashboard, "Download a full SQL backup" (keep a copy off the cloud, for example monthly) |

## Who can change what

- Every `/api` call needs a verified sign-in; production refuses unverified calls even if a setting is missing.
- Firestore: approved accounts can read and add or edit business records. Only Super Admin, Business Owner, Branch Manager, Accountant and Branch Person can delete them. The activity log can be added to but never edited or removed. Company settings can be changed only by Super Admin and Business Owner.
- The server limits request rates, hides database error details from users, and sends standard browser security headers.

## Recovering data

Always restore into a NEW instance or database first, check it, then copy back what is needed.

### Cloud SQL, to a moment in time (within 7 days)

```bash
gcloud sql instances clone YOUR_SQL_INSTANCE erp-restore --point-in-time "2026-10-14T05:00:00Z" --project YOUR_PROJECT_ID
```

### Cloud SQL, from a daily backup

```bash
gcloud sql backups list --instance YOUR_SQL_INSTANCE --project YOUR_PROJECT_ID
gcloud sql backups restore BACKUP_ID --restore-instance erp-restore --backup-instance YOUR_SQL_INSTANCE --project YOUR_PROJECT_ID
```

### Firestore, to a moment in time (within 7 days)

```bash
gcloud firestore databases clone --source-database="projects/YOUR_PROJECT_ID/databases/(default)" --destination-database=restored --snapshot-time="2026-10-14T05:00:00Z" --project YOUR_PROJECT_ID
```

### Firestore, from a scheduled backup

```bash
gcloud firestore backups list --project YOUR_PROJECT_ID
gcloud firestore databases restore --source-backup=BACKUP_RESOURCE_NAME --destination-database=restored --project YOUR_PROJECT_ID
```

## Routine

- Monthly: download the SQL backup from the owner dashboard and keep it somewhere outside Google Cloud.
- When someone leaves: set their account to not approved in Access Requests / Staff Directory.
- Keep the number of Super Admin accounts as small as possible.
