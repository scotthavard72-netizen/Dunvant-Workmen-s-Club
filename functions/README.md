# Staff alerts (Firebase Cloud Functions)

Sends phone push alerts and manager emails when there's a new staff sign-up,
an incident report, or an announcement. See `index.js`.

Email comes from a Gmail account, set with two secrets the first time you deploy:

- `ALERT_GMAIL_USER` — the Gmail address to send from
- `ALERT_GMAIL_APP_PASSWORD` — a Gmail *app password* for that account
  (myaccount.google.com/apppasswords — needs 2-Step Verification on)

Deploy from the project folder:

    cd functions && npm install && cd ..
    node node_modules\firebase-tools\lib\bin\firebase.js deploy --only functions
