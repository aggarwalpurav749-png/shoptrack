# ShopTrack – Orders, Estimate bills, Live tracking

Dukaan ka B2B ordering + agents + invoicing app. **Phase 1 me ye bana hai:**

| Feature | Status |
|---|---|
| Login (Owner / Agent), pehle login pe password change zaroori | ✅ |
| Agents banana, edit, disable, password reset, working hours | ✅ |
| Parties / Retailers: add, edit, delete, search, area / agent filter | ✅ |
| Parties bulk import (CSV / Excel): column mapping, check, duplicate, error report, sample template | ✅ |
| Products: add, edit, archive, delete, price history, stock badge, catalog grid | ✅ |
| Product photo: **Camera**, **Gallery**, **Internet search**, **Link paste**, multiple photos, main photo | ✅ |
| Hindi / English toggle, mobile-first UI, PWA (phone me install) | ✅ |
| Settings: shop naam, logo, bank, estimate prefix, working hours | ✅ |
| **Products bulk import** (CSV / Excel): mapping, check, SKU duplicate, update mode, error report | ✅ |
| **Internet photo search bina key ke** (Openverse + Wikimedia; Pexels/Pixabay key ho to wo bhi) | ✅ |
| **Agent order leta hai**: party chuno → catalog se qty → review → send (draft phone me save rehta hai) | ✅ |
| **Owner ko order dikhta hai**: status (Pending→Confirmed→Packed→Dispatched→Delivered), edit (qty / rate / discount / product add-remove), cancel | ✅ |
| **Owner estimate bill banata hai** order se (GST invoice nahi, GSTIN kahin nahi). Item ka GST % lagta hai, bill me ek "GST" amount dikhta hai. Round-off, amount in words, **Print / Save PDF**, WhatsApp share, cancel (stock + balance wapas) | ✅ |
| **Live agent location**: agent "Start duty" dabata hai, owner ko map pe dikhta hai, din ka route, battery, "signal lost" alert | ✅ |
| **Excel export**: din / hafta / mahina / koi bhi dates ke saare estimates ek .xlsx me (sheets: Estimates, Items, Summary) - apne software me chalane ke liye | ✅ |
| Payments / ledger / reports | ⏭ Phase 2 (baaki) |
| Visits (party pe check-in), route reports | ⏭ Phase 3 |

Stack: React + Vite + Tailwind (client), Node + Express (server), PostgreSQL (`pg`, bina Prisma ke – Termux pe issue nahi aata).
Server hi build ki hui React app bhi serve karta hai, to **ek hi command / ek hi address** se sab chalta hai.

---

## 1) Termux me chalana (Android)

```bash
pkg update && pkg upgrade -y
pkg install nodejs git unzip -y

# zip file Download folder me ho to:
termux-setup-storage
cp ~/storage/downloads/shoptrack.zip ~
unzip shoptrack.zip && cd shoptrack

npm run setup          # server + client ke packages install (5-10 min lag sakta hai)
cp server/.env.example server/.env
nano server/.env       # DATABASE_URL aur JWT_SECRET bharo (neeche step 2)
npm run build          # React app build
npm start              # server chalu
```

Phone ke browser me kholo: **http://localhost:5000**

Pehla login: `admin@shop.com` / `Admin@123` (`.env` me ADMIN_EMAIL / ADMIN_PASSWORD badal sakte ho). Turant naya password maangega.

**Demo data** (3 agents, 20 products, 10 parties) chahiye to ek baar: `npm run seed`
(Agents: `ravi@shop.com`, `suresh@shop.com`, `mohan@shop.com` – password `Agent@123`, pehle login pe badalna padega.)

Code badalte waqt: ek Termux session me `npm run dev:server`, doosre me `npm run dev:client` → http://localhost:5173

### Purana Phase 1 chal raha hai to update kaise kare (data nahi udta)

```bash
# 1. chalte server ko Ctrl+C se band karo, Postgres chalu hai ye dekho:
pg_ctl -D $PREFIX/var/lib/postgresql status || pg_ctl -D $PREFIX/var/lib/postgresql -l ~/pg.log start

# 2. naya zip purane folder ke upar kholo (.env aur database safe rehte hain)
cp ~/storage/downloads/shoptrack.zip ~
cd ~ && unzip -o shoptrack.zip && cd shoptrack

npm run setup      # naya package (map ke liye leaflet) install hoga
npm run build
npm start          # naye tables apne aap ban jaate hain
```

## 2) Database (Neon – free, sabse aasaan)

1. https://neon.tech pe account banao → **New project**.
2. Dashboard me **Connection string** copy karo (`postgresql://...sslmode=require`).
3. `server/.env` me `DATABASE_URL="..."` me paste karo.
4. `JWT_SECRET` me koi bhi 30+ akshar ka random text daalo.
5. Tables apne aap ban jaate hain jab server start hota hai (ya `npm run migrate`).

*(Termux me local Postgres chahiye to: `pkg install postgresql`, `mkdir -p $PREFIX/var/lib/postgresql && initdb $PREFIX/var/lib/postgresql && pg_ctl -D $PREFIX/var/lib/postgresql start`, `createdb shoptrack`, phir `DATABASE_URL="postgresql://$(whoami)@localhost:5432/shoptrack"`.)*

## 3) Photos ke liye (optional par zaroori Render pe)

- **Cloudinary** (free): https://cloudinary.com → Dashboard se `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` `.env` me daalo.
  Bina Cloudinary ke photos `server/uploads` folder me save hoti hain – apne phone/PC pe theek, **Render free pe restart ke baad ud jaati hain**.
- **Internet photo search**: ab **bina kisi key ke chalta hai** (Openverse + Wikimedia Commons). Key optional hai: https://www.pexels.com/api/ se free `PEXELS_API_KEY` (ya `PIXABAY_API_KEY`) daalo to aur achhi stock photos aati hain.
  Dhyan: ye free sources hain, kisi specific brand ke packet (Parle-G jaisa) ki photo har baar nahi milegi. Packet ke liye **Camera** ya **Link paste** behtar hai; search me "biscuit packet" jaise general shabd try karo.

## 4) GitHub pe daalna

```bash
git config --global user.name "Aapka Naam"
git config --global user.email "aapka@email.com"
git init && git add . && git commit -m "ShopTrack phase 1"
git branch -M main
# GitHub pe khaali repo banao (private rakho), phir:
git remote add origin https://github.com/USERNAME/shoptrack.git
git push -u origin main
```
Password ki jagah GitHub **Personal Access Token** (Settings → Developer settings → Tokens, `repo` permission) use hota hai.
`.env` file `.gitignore` me hai, wo upload nahi hogi – secrets safe.

## 5) Render pe deploy

1. https://render.com → **New +** → **Blueprint** → apni GitHub repo chuno (repo me `render.yaml` hai). Ya **Web Service** bana ke ye daalo:
   - Build Command: `npm --prefix server install && npm --prefix client install --include=dev && npm --prefix client run build`
   - Start Command: `npm --prefix server start`
2. Environment variables daalo: `DATABASE_URL` (Neon wali), `ADMIN_PASSWORD`, Cloudinary ki 3 keys, `PEXELS_API_KEY`. `JWT_SECRET` Blueprint khud bana deta hai.
3. Deploy ke baad `https://shoptrack-xxxx.onrender.com` khulega. Free plan 15 min idle ke baad so jata hai – pehli request 30-50 sec leti hai.
4. Demo data ek baar chahiye to `SEED_DEMO=true` daalke deploy karo, phir wapas `false` kar do.

## 6) Agents ke phone me install (PWA)

Agent ko link bhejo → Chrome me kholo → ⋮ menu → **Add to Home screen / Install app**. Ab ye app ki tarah khulega. Agent ko login details Agents page se (copy / WhatsApp button) bhej sakte ho.

## 6b) Agent order aur live location kaise chalta hai

1. **Owner**: Parties me party banao aur uska **Agent** chuno (agent sirf apni parties dekhta / order leta hai). Agents page me agent ke **working hours** set karo (nahi to Settings wale).
2. **Agent** login karke Home pe **"Start duty"** dabata hai → phone location permission maangega → **Allow**. Ab har ~20 second me location server ko jaati hai.
3. **Agent order**: Home → **Take new order** (ya party card pe "Take order") → products me **Add / +/-** → **Review order** → **Send order**.
4. **Owner**: Home pe "New orders" → order kholo → chahe to **Edit** karo → **Create estimate** → **Print / Save PDF** ya **WhatsApp**.
6. **Excel export**: Estimates page ke upar **Export to Excel** → Today / This week / This month / Last month ya apni dates → **Download Excel**. Cancelled estimates default me nahi aate (checkbox se aa sakte hain). Date India time (`APP_TZ`) ke hisaab se.
5. **Owner → Live tracking**: map pe har agent (hara = live, peela = 3+ min se signal nahi, bhoora = off duty). "Day route" se kisi din ka raasta.

**Location ki sachchai (zaroor padho):**
- Phone ka browser screen band hone par ya app band karne par GPS roak deta hai. Isliye agent ko **app khula aur screen on** rakhni hoti hai (app khud screen ko sone nahi deti jahan phone allow kare).
- Location sirf **duty ON + working hours ke andar** save hoti hai. Time ke baad apne aap duty band ho jaati hai.
- GPS ke liye **https ya localhost** chahiye. Render pe https milta hai (theek). Termux me sirf us phone ke `localhost` pe chalega; doosre phone se `http://192.168.x.x:5000` khologe to browser location band kar dega.
- 30 din se purani location history apne aap delete ho jaati hai.
- Time zone `Asia/Kolkata` hai; badalna ho to `.env` me `APP_TZ=...`.

Stock: estimate banate hi stock ghat jaata hai (estimate cancel karo to wapas). Order lete waqt stock check nahi hota, estimate ke waqt stock minus ho to chetavani dikhti hai.
Rates GST ke **bina** maane jaate hain; GST upar se judta hai.

## 6c) Android + Windows app (bina internet ke bhi chalta hai) — sab free

**Kaise kaam karta hai:** har phone / PC me app ke andar apna local database hota hai. Internet na ho to bhi agent order le sakta hai, owner estimate bana sakta hai. Net aate hi sab apne aap server pe chala jata hai (header me **Synced / Offline · N waiting** dikhta hai).

| Kaam | Bina internet | Internet chahiye |
|---|---|---|
| Agent: order lena, parties/products dekhna, order cancel (PENDING) | ✅ | |
| Agent: GPS location (compulsory, working hours me) | ✅ phone me save, net aate hi owner ko | |
| Owner: orders dekhna/edit, estimate banana/cancel, print, Excel export | ✅ | |
| Owner: party / product add-edit-delete, stock | ✅ | |
| Pehli baar login, naya agent banana, Settings save, photos, CSV import, live map ka fresh data | | ✅ |

**Build (free, GitHub Actions):**
1. Project GitHub pe push karo (section 4).
2. GitHub → **Actions** → **Build apps** → **Run workflow**. ~10 minute.
3. Khatam hone pe niche **Artifacts**: `ShopTrack-Android-apk` (zip me `app-debug.apk`) aur `ShopTrack-Windows-installer` (zip me `ShopTrack Setup.exe`).

**Install:** APK phone me bhejo → "Install unknown apps" allow → install. Windows: Setup.exe chalao.

**Pehli baar:** app kholo → **Shop server address** me apni Render link daalo (jaise `https://myshop.onrender.com`) → login. Pehla login/sync internet pe hona chahiye (data download hota hai). Uske baad offline.

**Agent location (compulsory):** working hours me tracking apne aap chalu ho jati hai, band nahi hoti. Location/GPS band ya permission deny → pura app block ho jata hai jab tak GPS on na ho, aur owner ko "GPS OFF at hh:mm" dikhta hai. Android pe permission **"Allow all the time"** do aur battery saver me ShopTrack ko "Unrestricted" karo, warna kuch phones screen off hone pe GPS rok dete hain.

**Dhyan rakho:**
- Offline order ke rate agent ke phone ke hisaab ke hote hain; sync pe server current rate se dobara check karta hai (owner ke rate/discount hi chalte hain).
- Offline me do jagah ek hi cheez badli (jaise owner aur agent ne ek hi order) to jo pehle server pe pahunche wo chalta hai; refuse hui change **Sync status** me dikhti hai.
- Order / estimate numbers server pehle se de deta hai (blocks), isliye offline print hua number final rehta hai.
- Logout tab hi hota hai jab sab kuch server pe pahunch chuka ho (phir phone se shop ka data hat jata hai).
- Windows PC me GPS nahi hota, isliye agent Android pe hi chalaye.
- Photos offline nahi dikhte jab tak pehle dekhe na ho (cache).
- Render free server 15 min idle pe so jata hai: pehla sync 30-50 second le sakta hai.

## 7) Aam errors aur fix

| Error | Fix |
|---|---|
| `DATABASE_URL is not set` | `server/.env` bana ke DATABASE_URL daalo |
| `ECONNREFUSED` / `timeout` | Neon string galat hai ya internet slow – dobara copy karo, `?sslmode=require` rehne do |
| `password authentication failed` | Neon me password reset karke nayi string daalo |
| `npm run build` Termux me memory error | Doosre apps band karo, phir `NODE_OPTIONS=--max-old-space-size=1024 npm run build` |
| Page blank / purana dikh raha hai | Browser me hard refresh; PWA ho to app band karke dubara kholo |
| Photo upload fail | Cloudinary keys check karo; ya `.env` se hata do to local folder use hoga |
| Internet photo search me kuch nahi aaya | Doosra shabd try karo (English me, general); internet check karo; chahe to `PEXELS_API_KEY` daalo |
| "Location is blocked" | Browser ⋮ → Site settings → Location → Allow; phone ka GPS on karo |
| Map blank / tiles nahi aa rahe | Internet chahiye (OpenStreetMap tiles) |
| Agent ka pin peela (No signal) | Agent ne app band kar di ya screen off / net nahi – app khol ke duty on dikhe to theek |
| Render pe photos gayab | Cloudinary lagao (Render free disk temporary hai) |
| Login "too many attempts" | 15 minute ruko |

## 8) Folder structure

```
shoptrack/
├─ client/            React app (src/pages, src/components, src/lib)
├─ server/
│  ├─ db/             schema.sql (saari tables), seed.js, migrate.js
│  ├─ src/routes/     auth, agents, parties, products, imageSearch, settings, dashboard, orders, invoices, tracking
│  ├─ src/utils/      import logic, image storage, safe download
│  └─ test/           npm test  (import logic ke unit tests)
├─ render.yaml
└─ README.md
```

## 9) Aage kya (Phase 2 baaki + Phase 3)

Ye ab ho chuka hai: order, estimate bill, print, live location, products import.
Baaki: **payments** (cash / UPI / cheque, partial payment, PAID/PARTIAL), **party ledger / udhaar statement**, **reports** (sale, agent-wise, due list), party pe **visit check-in**, order me **offline mode**. `payments` aur `visits` tables schema me pehle se hain.
