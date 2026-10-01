// Rider agreement. Riders sign this in the rider app before they can take orders,
// and the signed copy (this exact text) is saved for the owner.
// Have a lawyer review the wording. If you change it, also change CONTRACT_VERSION:
// every rider will then be asked to sign the new version.
import { SHOP } from "./config.js";
import { esc } from "./common.js";

export const CONTRACT_VERSION = "2026-09-30";

// r: the rider's profile { name, phone, license, vehicle, plate }
export function riderContract(r, date = new Date()) {
  const day = date.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  return `RIDER SERVICE AND CASH-HANDLING AGREEMENT

This Agreement is made on ${day} between ${SHOP.name.toUpperCase()}, located at ${SHOP.pickupAddress} (the "Shop"), and ${r.name}, of legal age, mobile number ${r.phone}, driver's license no. ${r.license || "—"}, using a ${String(r.vehicle || "vehicle").toLowerCase()} with plate no. ${r.plate || "—"} (the "Rider").

1. INDEPENDENT RIDER. The Rider delivers orders for the Shop as an independent service provider, not as an employee. The Rider may accept or decline orders. For each completed delivery, the Rider earns the delivery fee shown in the app.

2. FOOD AND MONEY HELD IN TRUST. Food the Rider picks up, and cash the Rider collects from customers, belong to the Shop, except the Rider's delivery fee. The Rider receives them in trust, only to deliver the food to the customer and to hand the money over to the Shop.

3. DELIVERY. Once the Rider accepts an order and picks up the food, the Rider must deliver it promptly to the customer's address and finish the delivery using the customer's delivery code. If the Rider cannot deliver, the Rider must call the Shop at once and return the food to the Shop.

4. HANDING OVER CASH. For cash orders, the Rider keeps the delivery fee and hands the food payment to the Shop on the same day, no later than the end of the Rider's shift, or as the Shop instructs.

5. MISAPPROPRIATION (ESTAFA). The Rider understands that keeping, using, or failing to deliver or return food or money received in trust, or denying having received it, may constitute estafa under Article 315 of the Revised Penal Code. In that case the Shop may file a criminal complaint and a civil claim, and the Rider must pay the full value of the food and money, plus the costs of collection allowed by law.

6. LOSS AND DAMAGE. The Rider is responsible for food or money lost or damaged through the Rider's fault or negligence. The Rider agrees that the Shop may deduct that value from delivery fees the Shop owes the Rider, with a written record of each deduction.

7. CONDUCT. The Rider must hold a valid driver's license and vehicle registration when driving, follow traffic laws, and treat customers politely. The Rider must never ask a customer for more than the amount shown in the app, never share customers' names, numbers or addresses, and never let another person use the Rider's account.

8. RECORDS AS EVIDENCE. The Rider agrees that the app's records, including when the Rider accepted, picked up and delivered each order, the delivery codes, payments and cash handovers, are accurate records of the Rider's deliveries and may be used as evidence.

9. SUSPENSION. The Shop may suspend or end this arrangement at any time, especially after customer complaints, missing money or undelivered orders. The Rider must immediately return any food or money still in the Rider's hands.

10. PERSONAL DATA. The Rider allows the Shop to keep the Rider's name, contact details, ID and vehicle details and delivery records to manage deliveries and for any complaint or legal claim, in line with the Data Privacy Act of 2012 (Republic Act No. 10173).

11. TRUE INFORMATION. The Rider confirms that the details and documents given to the Shop are true and belong to the Rider.

12. ELECTRONIC SIGNATURE. The Rider agrees that signing this Agreement in the app has the same legal effect as a handwritten signature under the Electronic Commerce Act (Republic Act No. 8792).`;
}

// A signed agreement (from the agreements collection) as a printable page
export function agreementHTML(a) {
  const when = a.signedAt?.toDate?.().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" }) || "";
  const sig = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(a.signature || "") ? a.signature : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rider Agreement – ${esc(a.signedName)}</title><style>
body{font-family:Georgia,"Times New Roman",serif;max-width:720px;margin:24px auto;padding:0 18px;color:#000;background:#fff;line-height:1.55;font-size:15px}
pre{white-space:pre-wrap;font-family:inherit;margin:0 0 18px}
h3{margin:22px 0 6px;font-size:15px;text-transform:uppercase;letter-spacing:.04em}
.sig img{height:90px;display:block;border-bottom:1px solid #000;margin-bottom:4px}
.line{margin-top:34px;border-top:1px solid #000;width:320px;padding-top:4px}
.small{font-size:12px;color:#333}
.noprint{margin:24px 0;display:flex;gap:8px}.noprint button{font:inherit;padding:8px 16px}
@media print{.noprint{display:none}body{margin:0 auto}}
</style></head><body>
<pre>${esc(a.contractText)}</pre>
<h3>Signed by the Rider</h3>
<div class="sig">${sig ? `<img src="${sig}" alt="Rider's signature">` : ""}<b>${esc(a.signedName)}</b></div>
<p class="small">Signed electronically in the ${esc(SHOP.name)} app on ${esc(when)}. Mobile ${esc(a.phone)}, driver's license no. ${esc(a.license || "—")}, plate no. ${esc(a.plate || "—")}. Agreement version ${esc(a.version)}.</p>
<h3>For the Shop</h3>
<div class="line">Signature over printed name</div>
<div class="line">Date</div>
<p class="small">For stronger evidence, print this page and have both parties sign it before a notary public.</p>
<div class="noprint"><button onclick="print()">Print</button><button onclick="close()">Close</button></div>
</body></html>`;
}
