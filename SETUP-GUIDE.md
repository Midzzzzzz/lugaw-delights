# Lugaw Delights App: Setup Guide

Your app has four pages:

| Page | Who uses it | What it does |
|---|---|---|
| `index.html` | Customers | Browse the menu, order for delivery or pickup, and track the order live |
| `rider.html` | Riders | Register, wait for your approval, then accept deliveries and mark them picked up and delivered |
| `seller.html` | Sellers at the counter | See new orders with a sound alert, move them through the kitchen, record dine-in orders, print receipts, open or close the store, settle cash with riders |
| `owner.html` | You (owner) | Sales for any date range, which seller and rider did the most, best-selling items, every order, and approving sellers and riders |

`admin.html` is a small page with a button for each dashboard.

**Sellers:** each seller opens `seller.html`, taps **New seller? Register**, and fills in their name, number, email and password. You approve them in **Owner dashboard â†’ Staff & riders**. Every order is credited to the seller who accepts it (online orders) or records it (dine-in), and the owner dashboard ranks sellers by sales. Orders from before this feature show as "Not recorded". To stop a seller, tap **Suspend**. They lose access right away. The owner and sellers have separate logins: the owner account can't open the seller dashboard and sellers can't open the owner dashboard. To take orders yourself, register a seller account for yourself. When a seller cancels an order they must pick a reason, and the customer sees it.

It runs on **Firebase** (Google's app backend) on the free plan. You don't need to install anything for the steps below. Set aside about 45 minutes.

---

## How an order flows

Delivery orders find a rider **before** the store cooks, so food is never left waiting without a rider. On the seller dashboard every delivery order stays in the **Delivery** tab while it's on its way: it doesn't move between tabs. Once it's delivered it leaves the Delivery tab and is listed in **Done today**. Each card shows its progress (Finding rider → Rider found → Cooking → Food ready → On the way → Delivered → Settled), with the current step highlighted, and the button for what to do next. The oldest order is at the top. Cancelled delivery orders go to **Cancelled**, and deliveries still to settle with the rider are also listed in **Settle with riders**. New, Kitchen and Ready for pickup are for pickup and dine-in orders.

1. Customer places a delivery order â†’ every approved rider who is switched to **Available** sees it and hears a chime. Your dashboard shows it in the **Delivery** tab as **Finding rider**, with how long it has waited and how many riders are available.
2. The first rider to tap **Accept** gets it. You hear a chime and the card shows **Rider found** with the button **Rider found: start cooking**. The customer sees "Rider found".
3. Tap **Rider found: start cooking** â†’ the customer sees "Preparing". You can't start cooking a delivery order before a rider accepts it.
4. When the food is ready, tap **Food ready**. The rider comes to the shop.
5. The rider pays you the food cost. Hand over the food only after they pay, then tap **Rider paid â‚±â€¦ Â· hand over food**. The rider collects the full amount from the customer and keeps the delivery fee.
6. The rider delivers and finishes with the customer's delivery code. The customer sees each step and the rider's name and number.

**No rider accepts?** Call a rider, or call the customer to let them know. If nobody can deliver, **Cancel** the order with the reason *No rider available right now*; the customer sees the reason.

**A rider drops out?** Before you start cooking, the order goes back to **Finding rider**. After you start cooking, the food keeps cooking and another rider can take it.

If a rider accepts an order and doesn't show up, tap **Send back to riders** so someone else can take it. Only the rider can mark a delivery delivered, by typing the customer's delivery code. If the customer can't show the code, call the customer; once they confirm they have the food, tap **Customer can't show the code?** and read the code to the rider.

Pickup orders skip the rider: **Ready for pickup** â†’ **Customer picked up**.

**Dine-in customers:** on the dashboard tap **+ Dine-in order**, then tap each item they order (one tap adds one; use the category tabs to find items faster, and − / + on the order list to fix amounts). Choose Cash or GCash and tap **Send to kitchen**. Call the customer by the order code (for example LD-AB12) when the food is ready. The order appears in the **Kitchen** tab. Tap **Served** when it's on the table. Dine-in orders count in today's sales, and you can record them even when online ordering is switched off. For cash, tap the amount the customer hands you (**Exact**, or a round amount like ₱200 or ₱500) and the page shows the change; type it under **Other amount** only if it isn't on a button. For GCash, tap **GCash received** if they've already paid, or **Pay later**.

**Kitchen staff:** the kitchen has its own login, separate from the cashiers. Each cook opens `kitchen.html` (in the seller app: **Kitchen staff? Sign in on the kitchen page**), taps **New kitchen staff? Register**, and fills in their name, number, email and password. You approve them in **Owner dashboard → Staff & riders → Kitchen staff**. The kitchen page shows only the orders being cooked: big tickets with the oldest first, how many minutes each has waited (yellow after 15 minutes), and any notes. Items added to a dine-in order show as **Items added**. The cook taps **Served**, **Ready for pickup** or **Food ready** when the food is done, and the cashier sees it right away. Kitchen staff can't see payments, customer names or numbers, or sales, and can't accept, change or cancel orders. Tap **Turn on order alerts** on the kitchen device so it chimes for each new ticket. Once a phone or tablet has opened the kitchen page, the seller app opens the kitchen page on it by itself; tap **Cashier? Sign in on the seller dashboard** to switch that device back. If no cook is signed in, the cashier can still mark food ready from the **Kitchen** tab on the seller dashboard.

**Inventory (ingredients):** inventory counts ingredients, not menu items. In **Owner dashboard → Inventory**, tap **Ingredients list** and add everything you want to count (Egg in pcs, Rice in cups, Chicken in servings, and so on), then **Save ingredients**. In the **Menu** tab, tap **Ingredients** on each item and set how much one serving uses. For drinks and other ready-made items, tap **Count this item itself** (one Coke uses one Coke). Items with no ingredients aren't counted; the Inventory tab lists any ordered item that wasn't counted so you can fix it. At the start of a shift, type how much of each ingredient you have and tap **Start count**. From then on every order (not cancelled) takes off what its items use: for example, with 10 eggs, one Lugaw with Egg and one Lugaw Overload 2 leave 8 eggs. The table shows each ingredient's beginning amount, how much was used, and what's left; yellow rows are running low and red rows are out. **Items become sold out by themselves** when an ingredient they need runs out: customers see **Sold out** instead of Add and can't order them, and on the seller dashboard the button is greyed out and can't be tapped (the others show **N left**, and you can't add more than what's left). Items without ingredients are always available. If more stock arrives, tap **Change beginning stock** and add it. At the end of the shift tap **End shift** (and again to confirm): the breakdown is saved, everything becomes available again, and **To restock** shows how much of each ingredient was used. To remove a count that was started by mistake (current or past), open it and tap **Delete this count** (and again to confirm); orders aren't affected. For the next shift tap **Start next count**, and **Fill in what was left last shift** to start from the leftovers. Keep the seller dashboard open during the shift: it updates the sold-out list for customers as orders come in.

**Refilling after a shift:** when the seller closes their shift, the open inventory count ends with it, and the kitchen page shows a **To refill** list (with a chime): every ingredient used during the shift and how much. The kitchen buys or prepares each one, ticks it, and changes the amount if they got more or less. When everything is ticked, they tap **All refilled: start the next count**: the list is marked done, and a new count starts by itself with what was left plus what was bought, ready for the next shift. In **Owner dashboard → Inventory**, an ended count shows *Waiting for the kitchen to refill* or *Refilled* with who did it and when (and any amounts that differ from what was used). Only the seller ends a count (by closing the shift) and only the kitchen marks it refilled; in the owner's Inventory tab the owner keeps the ingredients list, starts the very first count, and can change the beginning stock of the open count. If no count is open when the shift closes, the seller sees *No inventory count was open* and the kitchen gets no list: start a count in **Owner dashboard → Inventory**.

**Changing a dine-in order:** tap **Change order** on the dine-in order (in the Kitchen or Done today tab). Use − / + on what they already ordered (down to 0 removes it), and tap + on the menu for anything new, choosing **Take-out?** box or plastic if it's to go. Tap **Save changes**. New items go back to the Kitchen marked **Added**. Every removal is recorded with who removed it and when, and shows on the order and in the owner dashboard. You can remove items without adding anything. Orders can be changed any time while they're in the Kitchen or Done today tab, even after they're paid. If a paid order changes, the order card shows **collect ₱… more** or **give back ₱…**. Collect or return the money, then tap **Got ₱… more** or **Gave back ₱…** (and tap again to confirm). Until then the order stays in the **Unpaid** tab. The receipt shows the extra paid or the money given back.

**Served but not paid yet:** every dine-in order that hasn't been paid shows a red **Not paid yet** on its card and appears in the **Unpaid** tab, and the **Unpaid dine-in** tile shows how much is still owed. When the table pays cash, tap the amount they hand you (or type it under **Other amount**) and tap **Save payment** (the change is shown). For GCash, check the payment arrived in your GCash app, then tap **GCash received** and tap again to confirm. No Ref No. is needed. A payment can only be recorded once and can't be changed afterwards. A receipt printed before payment says **NOT PAID**, so it can be used as the bill.

If a table leaves without paying (or the order was a mistake), tap **Cancel** on the unpaid order and choose a reason. Paid orders can't be cancelled.

**Take-out boxes:** Lugaw, Rice Bowl and Dumpling items need a box when taken out: â‚±10 each (change `boxFee` in `config.js`). Delivery orders are always boxed, and the customer sees **Take-out boxes** in the total. For dine-in, choose **Take-out?** in the dine-in panel: **No, eating here**, **Box (+â‚±10 each)** or **Plastic (free)**. It applies to the items in that round, so a table that eats here and then wants some to go can use **Change order** and choose box or plastic. Add-ons and drinks never add a box fee. The rider pays the shop for food and boxes at pickup and keeps only the delivery fee.

**Shifts:** before selling, the seller counts the cash in the drawer and opens a shift on the seller dashboard (tap ₱0, ₱500, ₱1,000 or ₱2,000, or type the amount, then **Open shift**). Dine-in orders can only be taken while a shift is open. **The store follows the shift:** opening a shift opens the store for online orders, and closing it closes the store, so customers can only order while someone is at the counter (there's no separate store switch any more). At a handover the store is closed for the moment between one seller closing and the next opening. The shift bar shows the orders, sales and the cash that should be in the drawer; **Details** breaks it down (starting cash, cash sales, cash from riders, change given back, pay in and pay out, GCash, and dine-in orders not paid yet). Use **Pay in** when cash is put into the drawer (for example change money) and **Pay out** when cash is taken out (for example to buy ice), with a reason; the drawer opens for both. To end the shift, tap **Close shift**, count the drawer and type the amount (or tap **Exactly ₱…**): the page shows whether the cash is exact, over or short, saves the shift report and prints it on the Bluetooth printer. The next seller then opens a new shift. The owner sees every shift, with expected and counted cash, in **Owner dashboard → Shifts**. Sales the owner adds by hand or imports from Loyverse aren't part of any shift.

**Receipts:** every order on the dashboard has a **Print receipt** button. It opens a narrow receipt (made for 58 mm and 80 mm receipt printers, but any printer works) and the print window. The first time, your browser may ask you to allow pop-ups for the site. Say yes. On an Android phone with a Bluetooth receipt printer, install the printer's print service app (for example RawBT) so it appears in Chrome's print options. The receipt is an order slip, not a BIR official receipt.

**Bluetooth receipt printer and cash drawer (seller app on Android):** the seller app prints straight to a 58 mm Bluetooth receipt printer such as the JK-5801H, and opens the cash drawer plugged into the printer (the drawer opens when the printer tells it to, the same way Loyverse does it). Set it up once on the tablet: pair the printer in **Settings → Connections → Bluetooth**, open the seller app, tap **Set up printer → Show paired printers**, pick the printer (allow **Nearby devices** if the tablet asks), then tap **Test print**. From then on, a **cash** payment opens the drawer and prints the receipt; a **GCash** payment prints the receipt only; an order saved as *Pay later* does nothing until it's paid. **Open drawer** at the top opens the drawer any time, without a sale (for change or counting). **Print receipt** on an order prints on the Bluetooth printer. Untick **Print a receipt when a payment is saved** to only open the drawer. Close Loyverse on the tablet while using the app: only one app can be connected to the printer at a time. If the drawer doesn't open but receipts print, the drawer cable may be loose. This works in the seller app only; the website in a browser can't reach a Bluetooth printer.

The rider keeps the delivery fee (set in `config.js`). The food money is yours.

---

## Step 1. Create a Firebase project

1. Go to **console.firebase.google.com** and sign in with a Google account (use the business one).
2. Click **Create a project**, name it `lugaw-delights`, and finish the steps. You can turn Google Analytics off.

## Step 2. Create the database

1. In the left menu: **Build â†’ Firestore Database â†’ Create database**.
2. Location: choose **asia-southeast1 (Singapore)**, the closest to the Philippines. You can't change this later.
3. Choose **Start in production mode** and click **Create**.

## Step 3. Turn on sign-in

1. Left menu: **Build â†’ Authentication â†’ Get started**.
2. On the **Sign-in method** tab, enable **Email/Password** (just the first switch) and save.
3. Click **Add new provider** again and enable **Anonymous**. Customers use this in the background so they can order without making an account.

## Step 4. Add the security rules

1. Go to **Firestore Database â†’ Rules**.
2. Delete everything there, paste the whole contents of `firestore.rules` from this folder, and click **Publish**.

These rules are what stop customers from seeing other people's orders and stop riders from approving themselves. Don't skip this step.

## Step 5. Connect the app to Firebase

1. Click the gear icon â†’ **Project settings**. Under **Your apps**, click the web icon `</>`.
2. Nickname: `lugaw-web`. Leave "Firebase Hosting" unticked. Click **Register app**.
3. You'll see a block of code with `const firebaseConfig = { apiKey: ..., ... }`.
4. Open `public/config.js` in Notepad (or any text editor) and replace the `firebaseConfig` values with yours.
5. In the same file, fill in your shop phone, pickup address, GCash name and number, store hours and delivery fee.

The `apiKey` is safe to publish. It only identifies your project. The security rules are what protect your data.

## Step 6. Put the app online

**Easiest: Netlify (drag and drop, free)**

1. Go to **app.netlify.com/drop** and create a free account.
2. Drag the **`public`** folder onto the page. In a few seconds you get a link like `https://something-123.netlify.app`.
3. In Netlify, **Site configuration â†’ Change site name** to something like `lugawdelights` â†’ `https://lugawdelights.netlify.app`.
4. Back in Firebase: **Authentication â†’ Settings â†’ Authorized domains â†’ Add domain**, and add `lugawdelights.netlify.app` (your real one).

To update the site later (new prices, new menu), edit `config.js` and drag the `public` folder onto your site's **Deploys** page in Netlify.

**Alternative: Firebase Hosting** (needs Node.js on a computer). In this folder run `npm install -g firebase-tools`, `firebase login`, `firebase use --add` (pick your project), then `firebase deploy`. Your link will be `https://<project-id>.web.app`, which is already authorized.

## Step 7. Make yourself the owner

1. Open `https://<your-site>/owner.html`.
2. Type the email and password you want, and tap **Create owner account**.
3. The page shows **One more step** and your account ID. Tap **Copy ID**.
4. In Firebase: **Firestore Database â†’ Data â†’ Start collection**. Collection ID: `admins`. Document ID: paste your ID. Add one field: `name` (string) = `Owner`. Save.
5. Back on the owner page, tap **I've done it, reload**. You now see the owner dashboard.

Only accounts listed in `admins` can see all orders. Never share your owner password with riders or staff you don't fully trust. To give a manager access, have them create an account the same way and add their ID to `admins`.

## Testing on your computer (optional, before Step 1)

You can try the whole app on your own computer without a Firebase project, using the Firebase emulators. Nothing you do here is real or visible to anyone else.

1. Install **Node.js LTS** (nodejs.org) and **Java 21 or newer** (adoptium.net).
2. Open a terminal in this folder and run: `npx firebase-tools emulators:start --project demo-lugaw`
3. Serve the `public` folder from a local web server. With XAMPP, open `http://localhost/lugaw-app/public/`.
4. While `config.js` still has the `PASTE_YOUR_API_KEY` placeholder and the address is `localhost`, the pages show **Test mode** and use the emulators automatically.
5. To make yourself owner in test mode, follow step 7 but add the `admins` document at `http://127.0.0.1:4000/firestore` instead of the Firebase console.

Emulator data is wiped when you stop the emulators.

## Step 8. Test before you announce it

1. On your phone, open the main link and place a test order.
2. On the admin page, accept it and tap **Food ready: call a rider**.
3. On another phone, open `/rider.html`, register as a rider, then approve that rider in **Owner dashboard â†’ Staff & riders**.
4. As the rider, switch to **Available**, accept the order, mark it picked up and delivered.
5. Watch the customer phone update at each step, then cancel or complete any leftover test orders.

## Step 9. Share the links

- **Customers:** `https://<your-site>/` Post it on Facebook, Instagram and TikTok, and print it as a QR code at the stall.
- **Riders:** `https://<your-site>/rider.html` Post it in a "Riders wanted" post.
- **Sellers (the counter):** `https://<your-site>/seller.html` Bookmark it on the phone or tablet at the counter, tap **Turn on order alerts**, and keep it open during store hours.
- **You (owner):** `https://<your-site>/owner.html` for sales reports and approving sellers and riders.

---

## Daily use

- **Open and close:** the switch at the top of the dashboard. When closed, customers can browse but can't order.
- **Savings (owner only):** on the owner dashboard, open **Savings**. **Add savings** shows the sales for the chosen day (food and boxes, not rider fees) with a **Use** button; save all or part of it. **Add expense** records money paid from savings, by category (Ingredients, Supplies, Rent, Utilities, Salaries, Equipment, Other). The **Savings balance** is everything saved minus everything spent. **History** lists each month's entries with the running balance. Entries can't be edited: delete a wrong one and add it again.
- **Price warning:** if an order shows "Prices don't match your menu", someone edited the order. Check the total before cooking.
- **Payment:** online orders (delivery and pickup) are **cash on delivery or cash on pickup** only. Dine-in customers can still pay by cash or GCash at the counter. GCash orders placed before online GCash was removed still show the GCash reference number and **GCash payment received** button until they're finished.
- **Rider approval:** check the rider's driver's license, OR/CR and NBI or barangay clearance in person before tapping **Approve**. Use **Suspend** if there's a problem. After you approve a rider, their app shows the **Rider Agreement** (cash held in trust, handing over money, estafa under Article 315 of the Revised Penal Code, data privacy consent). They must type their name and sign with their finger before they can take any order. See and print each signed copy in **Owner dashboard â†’ Staff & riders â†’ View / print**. Have a lawyer review the wording in `public/contract.js`. For stronger evidence, print it and have it notarized. If you change the wording, change `CONTRACT_VERSION` in the same file and every rider signs again.
- **Paying riders:** every rider gives a GCash number or bank account when they register (riders who registered earlier are asked for it before they can take orders). At the end of the day, open **Settle with riders** on the seller dashboard: the top card shows, for each rider, the cash they owe you, the fees you owe them, and the difference, with the account to send it to. Only the rider can set or change their payout account and mobile number (**My details** in the rider app, which asks for their password). The owner can see it but can't change it. If a rider changed their payout account in the last 24 hours, the seller dashboard warns you: confirm with the rider in person, or on a number you already had, before sending money.
- **Adding a sale by hand** (for example sales from an earlier day that weren't recorded in the app): in **Owner dashboard → Orders**, tap **+ Add a sale**, pick the date and time, tap + on what was sold (pick a category to find items), choose Cash or GCash, and tap **Save sale**. It's saved as a paid dine-in order on that date, marked **Added by owner**, and counts in that day's sales. The date can't be in the future.
- **Importing sales from Loyverse:** in Loyverse, export **Receipts by item** as CSV. In **Owner dashboard → Orders**, tap **Import from Loyverse** and pick the file. You see the receipts and totals per day before anything is saved; tap **Import** to add them. Each receipt becomes a paid order on its own date and time, marked **From Loyverse** (payment is recorded as cash). Refunds are taken off the sale they refunded, take-out bowls become the box fee, and delivery charges become the delivery fee (which goes to riders, so it isn't counted in shop sales). Items are matched to your menu by name; items that aren't on the menu keep their Loyverse name and price. Importing the same file again skips receipts that are already in.
- **Food photos:** in **Owner dashboard → Menu**, tap **+ Photo** next to an item and pick a picture (from the gallery or the camera). It's saved right away and shows next to the item on the customer menu; customers can tap it to see it bigger. Use **Change** or **Remove** to replace or delete it. Square, well-lit photos of the actual dish look best.
- **Deleting orders** (for example test orders): in **Owner dashboard → Orders**, tick the orders (or the box at the top to select all shown), tap **Delete N orders** and tap again to confirm. You can also open an order and tap **Delete order**. Deleted orders disappear from the sales totals, reports and inventory counts (their stock comes back), and can't be brought back. Pick the date range first so you only see the orders you mean.
- **Changing the menu:** in **Owner dashboard → Menu**, pick a category at the top (or **+ Category**), then change names, prices and inclusions, tick **Best seller**, add or delete items, and move them up or down. Tap **Ingredients** on an item to set what one serving uses (for example Lugaw with Egg: 1 cup rice, 1 egg); see **Inventory** below. Tap **Save menu**. Customers and sellers see the new menu the next time they open or refresh the page or app. Orders placed at an old price are still accepted. Until you first save, the menu in `config.js` is used.

## Good to know

- **Cost:** the free Firebase plan allows about 50,000 reads and 20,000 writes a day, which covers a few hundred orders a day. If you ever outgrow it, Firebase will warn you before anything stops.
- **Alerts need the page open.** Browsers only play sounds on a page that's open and has been tapped once. Keep the admin page open at the counter, and ask riders to keep the rider page open while Available. There are no SMS or push notifications.
- **No live map.** Riders get a Google Maps link for each address, and customers see status updates, not the rider's location.
- **Riders call the customer first.** While a delivery order is looking for a rider, approved riders can see the customer's name, number and address, and must tap **Call customer** before they can accept it. This lets them check the order is real. If they can't confirm it (no answer, or a prank), they tap **Couldn't confirm** and the order is flagged on the seller dashboard so you can call the customer and cancel it if needed. Once a rider accepts, only that rider can see the customer's details. Pending and suspended riders never can.
- **Delivery areas and fees.** Customers can only order delivery to barangays in Los BaÃ±os and Bay, Laguna, and pick their barangay from a list. Each barangay has its own fee (farther = higher). Set the fees and tick which barangays you deliver to in **Owner dashboard â†’ Shop settings â†’ Delivery areas and fees**. The starting fees are only estimates, so set real ones before announcing. To add a barangay to the list, add it to `DELIVERY_ZONES` in `config.js`.
- **Confirmed numbers.** Orders from a number the shop hasn't called before show **New number: call to confirm** on the seller dashboard. Call it, and once someone answers, tap **Number confirmed** (twice). The shop remembers it, so that customer's next orders show **âœ“ Confirmed number**. Do the same for new sellers and riders on the owner dashboard before approving them.
- **Proof photos.** Riders can photograph the food when they pick it up and at the customer's door. Photos are time-stamped and can't be changed or deleted. See them with **Rider photos** on the seller dashboard, in the owner's order details, and next to customer reports. Each photo uses about 40-80 KB of the free plan's 1 GB database storage; check **Firestore â†’ Usage** monthly.
- **Delivery code (PIN).** Every delivery order shows the customer a 4-digit code. The rider must type it to mark the order delivered, so a rider can't claim a delivery that didn't happen. Customers should give the code only after they have their food. If the customer can't show the code, the seller calls the customer and, once they confirm they have the food, reads the code to the rider (**Customer can't show the code?** on the order).
- **Customer reports.** Customers can tap **Report a problem** on their order (food not received, rider asked for more money, rude rider, and so on). Reports appear in **Owner dashboard â†’ Reports**, where you can call the customer, suspend the rider, and mark the report resolved.
- **One order a minute per phone.** This stops someone from flooding you with fake orders. When the store is closed, the database itself refuses new orders.
- **Personal data:** you're collecting names, numbers and addresses of customers and riders. Under the Data Privacy Act, use them only for orders and deliveries, and keep your owner login private.
- **Riders are independent.** Agree in writing on the delivery fee, cash remittance, and what happens with cancellations or damaged food.

## Files

```
lugaw-app/
â”œâ”€â”€ public/            â† the website (upload this folder)
â”‚   â”œâ”€â”€ index.html     customer ordering
â”‚   â”œâ”€â”€ rider.html     rider sign-up and deliveries
â”‚   â”œâ”€â”€ seller.html    seller dashboard (orders, dine-in, receipts)
â”‚   â”œâ”€â”€ owner.html     owner dashboard (reports, sellers, riders)
â”‚   â”œâ”€â”€ admin.html     links to both dashboards
â”‚   â”œâ”€â”€ config.js      â† your settings and menu (the only file to edit)
â”‚   â”œâ”€â”€ common.js      shared code
â”‚   â”œâ”€â”€ style.css      design
â”‚   â”œâ”€â”€ logo.jpg, icon.png
â”œâ”€â”€ firestore.rules    â† paste into Firebase (step 4)
â”œâ”€â”€ firebase.json      only for the Firebase Hosting option
â””â”€â”€ SETUP-GUIDE.md     this guide
```
