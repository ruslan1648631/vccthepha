// ============================================================
// ระบบรายงานแจ้งเตือนวัคซีนใกล้หมดอายุ (< 3 เดือน) เข้า Telegram
// ทำงานผ่าน GitHub Actions ทุกวันที่ 20 ของทุกเดือน เวลา 08:00 น.
// ============================================================

async function run() {
  const supabaseUrl = process.env.SUPABASE_URL || "https://ioaclozxoinkbrnbtley.supabase.co";
  const supabaseKey = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvYWNsb3p4b2lua2JybmJ0bGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDk4NTUsImV4cCI6MjEwODEyNTg1NX0.xY3PVsmdqX2H3M2wvVsbAYgEoHVwuhFwy3Vagx76naM";
  const botToken = process.env.BOT_TOKEN || "8758808567:AAFoP_pRaWcZkWILgPTlHFYXwpwZP2OW1B4";
  const chatId = process.env.CHAT_ID || "-5333140982";

  const facMap = {
    "00860": "สสอ.เทพา",
    "11390": "รพ.เทพา",
    "09491": "รพ.สต.เกาะสะบ้า",
    "09492": "รพ.สต.ปากบาง",
    "09493": "รพ.สต.สะกอม",
    "09494": "รพ.สต.บ้านพระพุทธ",
    "09495": "รพ.สต.ลำไพล",
    "09496": "รพ.สต.ท่าม่วง",
    "09497": "รพ.สต.บ้านกระอาน",
    "09498": "รพ.สต.บ้านควนหรัน",
    "09499": "รพ.สต.บ้านกะโผะ",
    "09500": "รพ.สต.บ้านตาแปด",
    "11915": "รพ.สต.ทุ่งโดน"
  };

  function getFacName(code) {
    const c = String(code || "").padStart(5, "0");
    return facMap[c] || `รพ.สต. (${c})`;
  }

  console.log("📡 กำลังดึงข้อมูลคลังวัคซีนจาก Supabase...");
  const res = await fetch(`${supabaseUrl}/rest/v1/vaccine_stock?select=*`, {
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`
    }
  });

  if (!res.ok) {
    throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  }

  const rows = await res.json();
  console.log(`✅ ดึงข้อมูลสำเร็จ: ${rows.length} รายการรับ-จ่าย`);

  const balanceMap = {};
  const now = new Date();

  rows.forEach(r => {
    const key = `${r.hcode}_${r.vaccine_code}_${r.lot_no}`;
    const qty = Math.abs(Number(r.quantity_vials || 0));
    const doses = Number(r.doses_per_vial || 1);
    const tx = String(r.transaction_type || "").toUpperCase();

    if (!balanceMap[key]) {
      balanceMap[key] = {
        hcode: r.hcode,
        vaccine_code: r.vaccine_code,
        vaccine_name: r.vaccine_name || r.vaccine_code,
        lot_no: r.lot_no,
        exp_date: r.exp_date,
        doses_per_vial: doses,
        remaining_vials: 0,
        vvm: r.vvm_status || "Stage 1"
      };
    }

    if (["RECEIVE", "OPENING_BALANCE", "รับเข้า", "ยอดยกมา"].includes(tx)) {
      balanceMap[key].remaining_vials += qty;
    } else if (["ISSUE", "TRANSFER", "ADJUST_LOSS", "จ่ายออก", "ปรับลด"].includes(tx)) {
      balanceMap[key].remaining_vials -= qty;
    }
  });

  const balances = Object.values(balanceMap).filter(b => b.remaining_vials > 0);
  const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const thaiDate = `${now.getDate()} ${thaiMonths[now.getMonth()]} ${now.getFullYear() + 543}`;

  // กรองเฉพาะรายการที่ใกล้หมดอายุ <= 90 วัน หรือ หมดอายุแล้ว
  const alertList = balances.filter(b => {
    if (!b.exp_date) return false;
    const expD = new Date(b.exp_date);
    if (isNaN(expD.getTime())) return false;
    const diffDays = Math.ceil((expD - now) / (1000 * 60 * 60 * 24));
    return diffDays <= 90;
  });

  const grouped = {};
  let totalLots = 0;
  let totalVials = 0;
  let totalDoses = 0;
  let expiredCount = 0;

  alertList.forEach(b => {
    const hc = String(b.hcode || "00000").padStart(5, "0");
    if (!grouped[hc]) grouped[hc] = [];
    const expD = new Date(b.exp_date);
    const diffDays = Math.ceil((expD - now) / (1000 * 60 * 60 * 24));
    const expThai = `${expD.getDate()} ${thaiMonths[expD.getMonth()]} ${expD.getFullYear() + 543}`;
    const doses = b.remaining_vials * b.doses_per_vial;

    totalLots++;
    totalVials += b.remaining_vials;
    totalDoses += doses;
    if (diffDays < 0) expiredCount++;

    grouped[hc].push({
      name: b.vaccine_name,
      lot: b.lot_no,
      expThai,
      diffDays,
      vials: b.remaining_vials,
      doses,
      vvm: b.vvm
    });
  });

  let msg = "";
  if (totalLots === 0) {
    msg = `✅ <b>รายงานตรวจสอบวัคซีนใกล้หมดอายุ (&lt; 3 เดือน)</b>\n` +
          `📅 ประจำวันที่: <b>${thaiDate}</b>\n` +
          `🏛️ <b>เครือข่ายบริการสุขภาพอำเภอเทพา</b>\n\n` +
          `🎉 <b>ยอดเยี่ยม! ตรวจสอบแล้วไม่มีวัคซีนใกล้หมดอายุ (&lt; 90 วัน) ในทุกสถานพยาบาล</b>\n` +
          `วัคซีนคงคลังทุกรายการมีอายุการใช้งานมากกว่า 3 เดือน และอยู่ในเกณฑ์มาตรฐานความปลอดภัย\n\n` +
          `🔗 ตรวจสอบคลังวัคซีน: https://ruslan1648631.github.io/vccthepha/`;
  } else {
    msg = `⚠️ <b>รายงานแจ้งเตือนวัคซีนใกล้หมดอายุ (&lt; 3 เดือน)</b>\n` +
          `📅 ประจำวันที่: <b>${thaiDate}</b>\n` +
          `🏛️ <b>เครือข่ายบริการสุขภาพอำเภอเทพา</b>\n` +
          `━━━━━━━━━━━━━━━━━━━\n\n`;

    Object.keys(grouped).sort().forEach(hc => {
      const facName = getFacName(hc);
      msg += `🏥 <b>${facName}</b> (${hc}):\n`;
      grouped[hc].forEach(it => {
        let tag = "";
        if (it.diffDays < 0) {
          tag = `🔴 <b>หมดอายุแล้ว (${Math.abs(it.diffDays)} วัน)</b>`;
        } else if (it.diffDays <= 30) {
          tag = `🟠 <b>เหลือ ${it.diffDays} วัน</b>`;
        } else {
          tag = `🟡 เหลือ ${it.diffDays} วัน`;
        }
        msg += `  • <b>${it.name}</b> | Lot: <code>${it.lot}</code>\n` +
               `    - หมดอายุ: ${it.expThai} (${tag})\n` +
               `    - คงเหลือ: <b>${it.vials.toLocaleString()}</b> ขวด (${it.doses.toLocaleString()} โดส) | VVM: ${it.vvm}\n`;
      });
      msg += `\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━\n` +
           `📊 <b>สรุปภาพรวมทั้งอำเภอ:</b>\n` +
           `• วัคซีนใกล้หมดอายุ (&le; 90 วัน): <b>${totalLots}</b> Lot (${totalVials.toLocaleString()} ขวด / ${totalDoses.toLocaleString()} โดส)\n` +
           (expiredCount > 0 ? `• 🔴 มีวัคซีนหมดอายุแล้ว: <b>${expiredCount}</b> Lot (โปรดระงับการใช้)\n` : "") +
           `• คำแนะนำ: เร่งบริหารจัดการวัคซีนตามหลัก First Expire, First Out (FEFO) หรือกระจายให้หน่วยบริการที่มีอัตราการใช้วัคซีนสูง\n\n` +
           `🔗 ตรวจสอบคลังวัคซีน: https://ruslan1648631.github.io/vccthepha/`;
  }

  console.log("📲 กำลังส่งข้อความรายงานเข้ากลุ่ม Telegram...");
  const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: msg,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  const tgJson = await tgRes.json();
  if (!tgJson.ok) {
    throw new Error(`Telegram error: ${JSON.stringify(tgJson)}`);
  }
  console.log("🎉 ส่งรายงานแจ้งเตือนเข้า Telegram สำเร็จเรียบร้อยแล้ว!");
}

run().catch(err => {
  console.error("❌ เกิดข้อผิดพลาด:", err);
  process.exit(1);
});
