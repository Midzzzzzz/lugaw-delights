# Lugaw Delights: Online Ordering, Delivery and Point-of-Sale System

A real-time web app for a 24-hour lugaw restaurant in Los Baños, Laguna. Customers order online, sellers run the kitchen and dine-in counter, independent riders deliver, and the owner tracks sales and staff.

**Live site:** https://lugawdelights.netlify.app

## Who uses it

| Page | User | What it does |
|---|---|---|
| `index.html` | Customer | Menu, delivery or pickup ordering, cash or GCash, live order tracking, delivery code, problem reports |
| `seller.html` | Seller | New orders with sound alerts, kitchen flow, dine-in point of sale with change calculation, receipts, GCash payment matching, rider settlement |
| `rider.html` | Rider | Registration, digital rider agreement, available/offline switch, accept deliveries, proof photos, complete delivery with the customer's code |
| `owner.html` | Owner | Sales by date range, seller leaderboard, rider earnings, best-selling items, order search, approving sellers and riders, customer reports, delivery fees and cash limits |

## Features

- **Live updates:** order status changes appear instantly on every screen.
- **Delivery zones:** delivery only to barangays in Los Baños and Bay, each with its own fee, enforced by the database.
- **GCash payment matching:** customers enter their GCash reference number; sellers confirm it, and reused reference numbers are flagged.
- **Delivery code (PIN):** only the assigned rider can complete a delivery, and only with the customer's 4-digit code.
- **Proof photos:** the rider photographs the food at pickup and at the door. Photos are time-stamped by the server and can't be changed.
- **Rider agreement:** signed in the app with a finger signature before a rider can take orders, and printable for notarization.
- **Fraud protection:** one order a minute per customer, GCash required above a cash limit, riders pay for the food at pickup on cash orders, phone-number confirmation, and warnings when a rider's payout account changes.
- **Separate logins:** owner, seller and rider accounts each see only what they need.
- **Dine-in point of sale:** table numbers, cash received and change, and receipts for 58 mm and 80 mm printers.

## Built with

- HTML, CSS and JavaScript (ES modules), mobile-first, light and dark mode
- Firebase Cloud Firestore (real-time database) and Firebase Authentication
- Firestore Security Rules for access control and data validation
- Netlify for hosting

## Project structure

```
public/            the website (this folder is what gets deployed)
  index.html       customer ordering
  seller.html      seller dashboard
  rider.html       rider app
  owner.html       owner dashboard
  admin.html       links to the seller and owner dashboards
  config.js        Firebase settings, shop details, menu and delivery barangays
  common.js        shared code
  contract.js      rider agreement wording
  style.css        design
firestore.rules    database security rules
tests/             automated tests for the security rules
qr/                printable QR codes for ordering and rider sign-up
SETUP-GUIDE.md     step-by-step setup and daily use
```

## Running the security-rule tests

The tests run against the Firebase emulator on your computer, never the live database. You need Node.js and Java 21 or newer.

```
cd tests
npm install
npm test
```

All 225 tests in 12 files should pass.

## Setup

See [SETUP-GUIDE.md](SETUP-GUIDE.md) to create the Firebase project, publish the rules and put the site online.

The Firebase `apiKey` in `public/config.js` is meant to be public: it only identifies the project. The data is protected by `firestore.rules`.

## Credits

Requirements, design decisions, testing and deployment by Armida Contreras. Developed with AI-assisted programming (Claude by Anthropic).
