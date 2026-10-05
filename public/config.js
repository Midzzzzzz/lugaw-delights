// =====================================================================
//  LUGAW DELIGHTS — SETTINGS
//  This is the only file you need to edit. See SETUP-GUIDE.md.
// =====================================================================

// 1) Paste your Firebase web app config here (Firebase console →
//    Project settings → Your apps → SDK setup and configuration → Config).
export const firebaseConfig = {
  apiKey: "AIzaSyA3j3pQRnKhmXWpDKWL5cU10iJcIGl0EFE",
  authDomain: "lugaw-delights.firebaseapp.com",
  projectId: "lugaw-delights",
  storageBucket: "lugaw-delights.firebasestorage.app",
  messagingSenderId: "943478712137",
  appId: "1:943478712137:web:9de220045db55b02c39c98"
};

// 2) Your shop details.
export const SHOP = {
  name: "Lugaw Delights",
  hours: "24 hours",
  phone: "0932 474 8114",               // shown to customers and riders
  pickupAddress: "Tabi ng old Caltex / tapat ng Novo, Hi-way, Brgy. Batong Malake, Los Baños, Laguna",
  boxFee: 10,                            // take-out box, per piece, for menu sections marked box: true
  deliveryNote: "We deliver within Los Baños and Bay, Laguna. The fee depends on your barangay.",
  gcashName: "Ruel Calica",
  gcashNumber: "0932 474 8114"
};

// Delivery areas. Customers can only order delivery to these barangays.
// The fee (whole pesos, goes to the rider) is set per barangay on the owner
// dashboard → Shop settings; the numbers here are only the starting fees.
// Keep each id unique and don't change an id once it's in use.
export const DELIVERY_ZONES = [
  { town: "Los Baños", barangays: [
    ["lb-batong-malake", "Batong Malake", 30],
    ["lb-anos", "Anos", 40],
    ["lb-bagong-silang", "Bagong Silang", 60],
    ["lb-bambang", "Bambang", 40],
    ["lb-baybayin", "Baybayin", 40],
    ["lb-bayog", "Bayog", 40],
    ["lb-lalakay", "Lalakay", 40],
    ["lb-maahas", "Maahas", 40],
    ["lb-malinta", "Malinta", 40],
    ["lb-mayondon", "Mayondon", 40],
    ["lb-putho-tuntungin", "Putho-Tuntungin", 40],
    ["lb-san-antonio", "San Antonio", 40],
    ["lb-tadlac", "Tadlac", 40],
    ["lb-timugan", "Timugan", 40]
  ]},
  { town: "Bay", barangays: [
    ["bay-bitin", "Bitin", 60],
    ["bay-calo", "Calo", 60],
    ["bay-dila", "Dila", 60],
    ["bay-maitim", "Maitim", 60],
    ["bay-masaya", "Masaya", 60],
    ["bay-paciano-rizal", "Paciano Rizal", 60],
    ["bay-puypuy", "Puypuy", 60],
    ["bay-san-agustin", "San Agustin (Poblacion)", 60],
    ["bay-san-antonio", "San Antonio", 60],
    ["bay-san-isidro", "San Isidro", 60],
    ["bay-san-nicolas", "San Nicolas (Poblacion)", 60],
    ["bay-santa-cruz", "Santa Cruz", 60],
    ["bay-santo-domingo", "Santo Domingo", 60],
    ["bay-tagumpay", "Tagumpay", 60],
    ["bay-tranca", "Tranca", 60]
  ]}
];

// 3) Menu. Sections with box: true add SHOP.boxFee per piece when packed in a take-out box
//    (always for delivery; for dine-in when the seller chooses "Box").
//    Keep each id unique and never reuse an old id for a different item.
//    Prices are whole pesos (no centavos).
//    [id, name, price, inclusions (optional), best seller (optional)]
export const MENU = [
  { id: "lugaw", name: "Lugaw Series", box: true, items: [
    ["L01", "Plain Lugaw", 39],
    ["L02", "Lugaw with Egg and Stripe", 85],
    ["L03", "Lugaw with Chicken", 79],
    ["L04", "Lugaw with Liver", 69],
    ["L05", "Lugaw with Lechon Kawali", 89],
    ["L06", "Lugaw with Chicharon Bulaklak", 89],
    ["L07", "Lugaw with Dumplings", 89],
    ["L08", "Lugaw Overload 1", 129, "Egg + Chicken + Liver + Tofu"],
    ["L09", "Lugaw Overload 2", 159, "Egg + Lechon Kawali + Chicharon Bulaklak"],
    ["L10", "Lugaw Delights", 189, "Egg + Chicken + Liver + Lechon Kawali + Chicharon Bulaklak + Tofu", true]
  ]},
  { id: "rice", name: "Rice Bowl Series", box: true, items: [
    ["R01", "Plain Fried Rice", 69],
    ["R02", "Fried Rice with Egg", 99],
    ["R03", "Fried Rice with Chicken", 109],
    ["R04", "Fried Rice with Chicken Liver", 109],
    ["R05", "Fried Rice with Lechon Kawali", 119],
    ["R06", "Fried Rice with Chicharon Bulaklak", 119],
    ["R07", "Fried Rice with Tofu", 99],
    ["R08", "Fried Rice Overload 1", 159, "Chicken Wings + Chicken Liver + Egg + Tofu"],
    ["R09", "Fried Rice Overload 2", 159, "Lechon Kawali + Chicharon Bulaklak + Egg"]
  ]},
  { id: "dumplings", name: "Dumpling Series", box: true, items: [
    ["D01", "Fried Dumplings (5 pcs)", 75],
    ["D02", "Steam Dumplings (5 pcs)", 75],
    ["D03", "Dumpling Soup (3 pcs)", 129, "With bokchoy and meatballs"]
  ]},
  { id: "addons", name: "Add-ons", note: "Top up any bowl", items: [
    ["A01", "Add-on: Egg", 20],
    ["A02", "Add-on: Chicken", 40],
    ["A03", "Add-on: Liver", 40],
    ["A04", "Add-on: Lechon Kawali", 50],
    ["A05", "Add-on: Chicharon Bulaklak", 50],
    ["A06", "Add-on: Tofu", 20],
    ["A07", "Add-on: Dumplings (3 pcs)", 59]
  ]},
  { id: "drinks", name: "Drinks", items: [
    ["B01", "Mineral Water", 15],
    ["B02", "Coke", 25],
    ["B03", "Royal", 25],
    ["B04", "Sprite", 25]
  ]}
];
