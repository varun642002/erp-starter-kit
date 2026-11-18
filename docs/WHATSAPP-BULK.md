# Sending a marketing message to 200 people at once

The ERP's **WhatsApp Messages > Bulk marketing** tab can send one approved message to a whole group (up to 200 people)
with one button. WhatsApp only allows this through the **WhatsApp Business Platform (Cloud API)**, so a one-time setup is needed.
Until it is done, the tab still works person by person with the **Open next** button.

## One-time setup (Meta side)

1. Create a Meta Business account and a WhatsApp Business account at business.facebook.com, and add the shop's phone number.
   The number must not be in use in the normal WhatsApp app.
2. In Meta for Developers create an app, add the WhatsApp product, and note the **Phone number ID**.
3. Create a permanent access token (System User with `whatsapp_business_messaging` permission).
4. Create a message template in WhatsApp Manager:
   - Category: **Marketing**
   - Name: for example `marketing_offer`
   - Language: English (or Tamil, see below)
   - Body (two variables):

     ```
     Dear {{1}},

     {{2}}

     Your Company Name, Your City.
     Reply STOP if you do not want these messages.
     ```
   - Wait for Meta to approve it (usually minutes to a day).

## Server settings

Put the values in Secret Manager and give them to the Cloud Run service `your-service`:

| Name | Value |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID |
| `WHATSAPP_ACCESS_TOKEN` | the permanent access token (secret) |
| `WHATSAPP_MARKETING_TEMPLATE_NAME` | `marketing_offer` (the approved template name) |
| `WHATSAPP_MARKETING_TEMPLATE_LANG` | `en` (or the language code the template was approved in, e.g. `ta`) |

The first two are the same values the automatic invoice sender uses.

## Things to know

- Meta charges for each marketing message. Check the current India rate in WhatsApp Manager before a big send.
- Only people who agreed to hear from the shop should be messaged. People who reply STOP must not be messaged again; the ERP
  does not yet read replies, so remove them from the Customers list or block them.
- The offer text goes into variable `{{2}}`: one line, no line breaks.
- A number already sent in a campaign is never sent again in the same campaign. Each message (sent or failed) is saved in History.
